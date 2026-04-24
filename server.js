const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== CORS =====
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
  methods: ['GET', 'POST'],
}));
app.use(express.json());

// ===== MULTER — รับไฟล์ upload =====
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `upload-${Date.now()}${ext}`); // เก็บ extension ไว้
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.stl', '.step', '.3mf'].includes(ext)) cb(null, true);
    else cb(new Error('ไฟล์ต้องเป็น STL, STEP หรือ 3MF เท่านั้น'));
  }
});

// ===== ORCASLICER CONFIG PATH =====
// Profile ของ Bambu P1P อยู่ใน /app/profiles/
const ORCA_BIN = process.env.ORCA_BIN || '/usr/bin/orca-slicer';
const PROFILES_DIR = path.join(__dirname, 'profiles');
const PRINTER_PROFILE = path.join(PROFILES_DIR, 'bambu_p1p.json');
const FILAMENT_PROFILES = {
  PLA:  path.join(PROFILES_DIR, 'filament_pla.json'),
  PETG: path.join(PROFILES_DIR, 'filament_petg.json'),
  ASA:  path.join(PROFILES_DIR, 'filament_asa.json'),
  TPU:  path.join(PROFILES_DIR, 'filament_tpu.json'),
  Standard:  path.join(PROFILES_DIR, 'resin_standard.json'),
  'H-Clear': path.join(PROFILES_DIR, 'resin_hclear.json'),
  'ABS-Like': path.join(PROFILES_DIR, 'resin_abslike.json'),
  Tough: path.join(PROFILES_DIR, 'resin_tough.json'),
};
const LAYER_PROFILES = {
  '0.08': path.join(PROFILES_DIR, 'layer_ultra_fine.json'),
  '0.16': path.join(PROFILES_DIR, 'layer_optimal.json'),
  '0.24': path.join(PROFILES_DIR, 'layer_coarse.json'),
};

// ===== HEALTH CHECK =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0' });
});

// ===== SLICE ENDPOINT =====
// POST /slice
// Body: multipart/form-data
//   file: STL/STEP/3MF file
//   material: PLA | PETG | ASA | TPU | Standard | H-Clear | ABS-Like | Tough
//   layer: 0.08 | 0.16 | 0.24
//   infill: 15 | 25 | 50 | 80
//   scale_x: float (default 1.0)
//   scale_y: float (default 1.0)
//   scale_z: float (default 1.0)
app.post('/slice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });

  const {
    material = 'PLA',
    layer    = '0.16',
    infill   = '25',
    scale_x  = '1',
    scale_y  = '1',
    scale_z  = '1',
  } = req.body;

  const inputFile  = req.file.path; // มี extension แล้วเพราะใช้ diskStorage
  const outputDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-'));
  const gcodeFile  = path.join(outputDir, 'output.gcode');

  try {
    // ===== BUILD PRUSASLICER COMMAND =====
    const infillPct = parseInt(infill);
    const sx = parseFloat(scale_x), sy = parseFloat(scale_y), sz = parseFloat(scale_z);

    const scaleArg = (sx !== 1 || sy !== 1 || sz !== 1)
      ? `--scale ${sx * 100},${sy * 100},${sz * 100}`
      : '';

    const layerMM = layer || '0.16';

    const cmd = [
      'prusa-slicer',
      '--export-gcode',
      `--layer-height ${layerMM}`,
      `--fill-density ${infillPct}%`,
      `--fill-pattern grid`,
      '--support-material',            // เปิด support อัตโนมัติ
      '--support-material-auto',       // auto detect
      '--support-material-threshold 45', // angle threshold
      scaleArg,
      '--output', `"${gcodeFile}"`,
      `"${inputFile}"`
    ].filter(Boolean).join(' ');

    console.log('Running slicer:', cmd);
    await runCommand(cmd, 180000); // timeout 3 นาที (เพราะมี support)

    // ===== PARSE GCODE RESULT =====
    const result = parseGcode(gcodeFile);
    res.json({
      success: true,
      weight_g: result.weight,
      print_time_hrs: result.timeHrs,
      print_time_str: result.timeStr,
      filament_m: result.filamentM,
      layer_count: result.layers,
    });

  } catch (err) {
    console.error('Slice error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    // cleanup
    try { fs.unlinkSync(inputFile); } catch {}
    try { fs.rmSync(outputDir, { recursive: true }); } catch {}
  }
});

// ===== PARSE GCODE =====
function parseGcode(gcodeFile) {
  if (!fs.existsSync(gcodeFile)) throw new Error('ไม่พบไฟล์ gcode');

  const text = fs.readFileSync(gcodeFile, 'utf8');
  const lines = text.split('\n');

  let weight = null, timeHrs = null, timeStr = null, filamentM = null, layers = null;
  let totalWeightG = 0; // รวม weight จากทุก extruder (model + support)

  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith(';')) continue;

    // PrusaSlicer: ; filament used [g] = 12.34
    // อาจมีหลายบรรทัดสำหรับแต่ละ extruder — sum ทั้งหมด
    const mG = t.match(/;\s*filament\s+used\s*\[g\]\s*=\s*([\d.]+)/i);
    if (mG) totalWeightG += parseFloat(mG[1]);

    // PrusaSlicer: ; filament used [mm3] = 12345.67 → แปลงเป็น g
    if (totalWeightG === 0) {
      const mMM3 = t.match(/;\s*filament\s+used\s*\[mm3?\]\s*=\s*([\d.]+)/i);
      if (mMM3) totalWeightG += parseFloat(mMM3[1]) * 1.24 / 1000;
    }

    // PrusaSlicer: ; filament used [cm3] = 12.34 → แปลงเป็น g
    if (totalWeightG === 0) {
      const mCM3 = t.match(/;\s*filament\s+used\s*\[cm3?\]\s*=\s*([\d.]+)/i);
      if (mCM3) totalWeightG += parseFloat(mCM3[1]) * 1.24;
    }

    // Cura: ;Filament used: 1.23456m
    if (!filamentM) {
      const mM = t.match(/;Filament\s+used:\s*([\d.]+)m$/i);
      if (mM) {
        filamentM = parseFloat(mM[1]);
        if (totalWeightG === 0) totalWeightG = filamentM * Math.PI * (0.0875 ** 2) * 100 * 1.24;
      }
    }

    // Cura: ;TIME:4567
    if (!timeHrs) {
      const mT = t.match(/^;TIME:(\d+)$/);
      if (mT) {
        const secs = parseInt(mT[1]);
        timeHrs = secs / 3600;
        timeStr = formatSecs(secs);
      }
    }

    // PrusaSlicer / OrcaSlicer / Bambu: ; estimated printing time ... = 1h 23m 45s
    if (!timeHrs) {
      const mTime = t.match(/;\s*estimated\s+printing\s+time.*?=\s*(.+)/i);
      if (mTime) {
        timeStr = mTime[1].trim();
        timeHrs = parseTimeStr(timeStr);
      }
    }

    // Layer count
    if (!layers) {
      const mL = t.match(/;\s*(?:total\s+)?layers?\s*(?:count\s*)?[:=]\s*(\d+)/i);
      if (mL) layers = parseInt(mL[1]);
    }
  }

  if (totalWeightG > 0) weight = totalWeightG;

  console.log('Parsed: weight=', weight, 'timeHrs=', timeHrs, 'timeStr=', timeStr);

  // Correction factor จาก calibration กับ Bambu PLA Basic จริง
  // Bambu Studio: 54.07g / PrusaSlicer: 36.65g = 1.476 ≈ 1.48
  // เพราะ PrusaSlicer generate support น้อยกว่า Bambu Studio
  const WEIGHT_CORRECTION = 1.48;
  if (weight) weight = weight * WEIGHT_CORRECTION;

  if (!weight && !timeHrs) throw new Error('ไม่สามารถ parse ข้อมูลจาก gcode ได้');
  if (!weight) weight = 0;
  if (!timeHrs) timeHrs = 0;

  return {
    weight:    Math.round(weight * 100) / 100,
    timeHrs:   Math.round(timeHrs * 100) / 100,
    timeStr:   timeStr || formatSecs(Math.round(timeHrs * 3600)),
    filamentM: filamentM ? Math.round(filamentM * 100) / 100 : null,
    layers:    layers || null,
  };
}

// ===== HELPERS =====
function runCommand(cmd, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const proc = exec(cmd, { timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message));
      else resolve(stdout);
    });
  });
}

function parseTimeStr(str) {
  // "1h 23m 45s" or "23m 45s" or "45s"
  let hrs = 0, mins = 0, secs = 0;
  const hm = str.match(/(\d+)h/); if (hm) hrs  = parseInt(hm[1]);
  const mm = str.match(/(\d+)m/); if (mm) mins = parseInt(mm[1]);
  const sm = str.match(/(\d+)s/); if (sm) secs = parseInt(sm[1]);
  return hrs + mins / 60 + secs / 3600;
}

function formatSecs(totalSecs) {
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  let str = '';
  if (h) str += `${h}h `;
  if (m) str += `${m}m `;
  str += `${s}s`;
  return str.trim();
}

// ===== START =====
app.listen(PORT, () => {
  console.log(`Print3DHub Slicer API running on port ${PORT}`);
  console.log(`OrcaSlicer binary: ${ORCA_BIN}`);
});
