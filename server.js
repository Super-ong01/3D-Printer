// const express = require('express');
// const multer = require('multer');
// const cors = require('cors');
// const { exec } = require('child_process');
// const path = require('path');
// const fs = require('fs');
// const os = require('os');

// const app = express();
// const PORT = process.env.PORT || 3000;

// // ===== CORS =====
// app.use(cors({
//   origin: process.env.ALLOWED_ORIGIN || '*',
//   methods: ['GET', 'POST'],
// }));
// app.use(express.json());

// // ===== SLICE QUEUE =====
// // slice ทีละ 1 งานเพื่อป้องกัน RAM เกิน (PrusaSlicer ใช้ ~500MB/process)
// let sliceRunning = false;
// const sliceQueue = [];

// function processQueue() {
//   if (sliceRunning || sliceQueue.length === 0) return;
//   sliceRunning = true;
//   const { task, resolve, reject } = sliceQueue.shift();
//   console.log(`Queue: running task (${sliceQueue.length} remaining)`);
//   task().then(resolve).catch(reject).finally(() => {
//     sliceRunning = false;
//     processQueue(); // รัน task ถัดไป
//   });
// }

// function enqueueSlice(task) {
//   return new Promise((resolve, reject) => {
//     sliceQueue.push({ task, resolve, reject });
//     console.log(`Queue: added task (queue size: ${sliceQueue.length})`);
//     processQueue();
//   });
// }

// // ===== MULTER — รับไฟล์ upload =====
// const storage = multer.diskStorage({
//   destination: os.tmpdir(),
//   filename: (req, file, cb) => {
//     const ext = path.extname(file.originalname).toLowerCase();
//     cb(null, `upload-${Date.now()}${ext}`);
//   }
// });

// const upload = multer({
//   storage,
//   limits: { fileSize: 100 * 1024 * 1024 },
//   fileFilter: (req, file, cb) => {
//     const ext = path.extname(file.originalname).toLowerCase();
//     if (['.stl', '.step', '.3mf'].includes(ext)) cb(null, true);
//     else cb(new Error('ไฟล์ต้องเป็น STL, STEP หรือ 3MF เท่านั้น'));
//   }
// });

// // ===== ORCASLICER CONFIG PATH =====
// // Profile ของ Bambu P1P อยู่ใน /app/profiles/
// const ORCA_BIN = process.env.ORCA_BIN || '/usr/bin/orca-slicer';
// const PROFILES_DIR = path.join(__dirname, 'profiles');
// const PRINTER_PROFILE = path.join(PROFILES_DIR, 'bambu_p1p.json');
// const FILAMENT_PROFILES = {
//   PLA:  path.join(PROFILES_DIR, 'filament_pla.json'),
//   PETG: path.join(PROFILES_DIR, 'filament_petg.json'),
//   ASA:  path.join(PROFILES_DIR, 'filament_asa.json'),
//   TPU:  path.join(PROFILES_DIR, 'filament_tpu.json'),
//   Standard:  path.join(PROFILES_DIR, 'resin_standard.json'),
//   'H-Clear': path.join(PROFILES_DIR, 'resin_hclear.json'),
//   'ABS-Like': path.join(PROFILES_DIR, 'resin_abslike.json'),
//   Tough: path.join(PROFILES_DIR, 'resin_tough.json'),
// };
// const LAYER_PROFILES = {
//   '0.08': path.join(PROFILES_DIR, 'layer_ultra_fine.json'),
//   '0.16': path.join(PROFILES_DIR, 'layer_optimal.json'),
//   '0.24': path.join(PROFILES_DIR, 'layer_coarse.json'),
// };

// // ===== HEALTH CHECK =====
// app.get('/health', (req, res) => {
//   res.json({ status: 'ok', version: '1.0.0', queue: sliceQueue.length, busy: sliceRunning });
// });

// // ===== QUEUE STATUS =====
// app.get('/queue', (req, res) => {
//   res.json({ queue: sliceQueue.length, busy: sliceRunning });
// });

// // ===== SLICE ENDPOINT =====
// app.post('/slice', upload.single('file'), async (req, res) => {
//   if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });

//   // ถ้า queue เต็มเกิน 5 งาน ปฏิเสธทันที
//   if (sliceQueue.length >= 5) {
//     try { fs.unlinkSync(req.file.path); } catch {}
//     return res.status(503).json({ error: 'Server ยุ่งมาก กรุณาลองใหม่ใน 2-3 นาที' });
//   }

//   const { material='PLA', layer='0.16', infill='25', scale_x='1', scale_y='1', scale_z='1' } = req.body;
//   const inputFile = req.file.path;

//   try {
//     const result = await enqueueSlice(() => runSlice(inputFile, { material, layer, infill, scale_x, scale_y, scale_z }));
//     res.json(result);
//   } catch (err) {
//     console.error('Slice error:', err.message);
//     res.status(500).json({ error: err.message });
//   } finally {
//     try { fs.unlinkSync(inputFile); } catch {}
//   }
// });

// async function runSlice(inputFile, { material, layer, infill, scale_x, scale_y, scale_z }) {
//   const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-'));
//   const gcodeFile = path.join(outputDir, 'output.gcode');

//   try {
//     // ===== BUILD PRUSASLICER COMMAND =====
//     const infillPct = parseInt(infill);
//     const sx = parseFloat(scale_x), sy = parseFloat(scale_y), sz = parseFloat(scale_z);

//     const scaleArg = (sx !== 1 || sy !== 1 || sz !== 1)
//       ? `--scale ${sx * 100},${sy * 100},${sz * 100}`
//       : '';

//     const layerMM = layer || '0.16';

//     const cmd = [
//       'prusa-slicer',
//       '--export-gcode',
//       `--layer-height ${layerMM}`,
//       `--fill-density ${infillPct}%`,
//       `--fill-pattern grid`,
//       '--support-material',            // เปิด support อัตโนมัติ
//       '--support-material-auto',       // auto detect
//       '--support-material-threshold 45', // angle threshold
//       scaleArg,
//       '--output', `"${gcodeFile}"`,
//       `"${inputFile}"`
//     ].filter(Boolean).join(' ');

//     console.log('Running slicer:', cmd);
//     await runCommand(cmd, 180000); // timeout 3 นาที (เพราะมี support)

//     // ===== PARSE GCODE RESULT =====
//     const result = parseGcode(gcodeFile, infill);
//     return {
//       success: true,
//       weight_g: result.weight,
//       print_time_hrs: result.timeHrs,
//       print_time_str: result.timeStr,
//       filament_m: result.filamentM,
//       layer_count: result.layers,
//     };

//   } finally {
//     try { fs.rmSync(outputDir, { recursive: true }); } catch {}
//   }
// }

// // ===== PARSE GCODE =====
// function parseGcode(gcodeFile, infill = '25') {
//   if (!fs.existsSync(gcodeFile)) throw new Error('ไม่พบไฟล์ gcode');

//   const text = fs.readFileSync(gcodeFile, 'utf8');
//   const lines = text.split('\n');

//   let weight = null, timeHrs = null, timeStr = null, filamentM = null, layers = null;
//   let totalWeightG = 0; // รวม weight จากทุก extruder (model + support)

//   for (const line of lines) {
//     const t = line.trim();
//     if (!t.startsWith(';')) continue;

//     // PrusaSlicer: ; filament used [g] = 12.34
//     // อาจมีหลายบรรทัดสำหรับแต่ละ extruder — sum ทั้งหมด
//     const mG = t.match(/;\s*filament\s+used\s*\[g\]\s*=\s*([\d.]+)/i);
//     if (mG) totalWeightG += parseFloat(mG[1]);

//     // PrusaSlicer: ; filament used [mm3] = 12345.67 → แปลงเป็น g
//     if (totalWeightG === 0) {
//       const mMM3 = t.match(/;\s*filament\s+used\s*\[mm3?\]\s*=\s*([\d.]+)/i);
//       if (mMM3) totalWeightG += parseFloat(mMM3[1]) * 1.24 / 1000;
//     }

//     // PrusaSlicer: ; filament used [cm3] = 12.34 → แปลงเป็น g
//     if (totalWeightG === 0) {
//       const mCM3 = t.match(/;\s*filament\s+used\s*\[cm3?\]\s*=\s*([\d.]+)/i);
//       if (mCM3) totalWeightG += parseFloat(mCM3[1]) * 1.24;
//     }

//     // Cura: ;Filament used: 1.23456m
//     if (!filamentM) {
//       const mM = t.match(/;Filament\s+used:\s*([\d.]+)m$/i);
//       if (mM) {
//         filamentM = parseFloat(mM[1]);
//         if (totalWeightG === 0) totalWeightG = filamentM * Math.PI * (0.0875 ** 2) * 100 * 1.24;
//       }
//     }

//     // Cura: ;TIME:4567
//     if (!timeHrs) {
//       const mT = t.match(/^;TIME:(\d+)$/);
//       if (mT) {
//         const secs = parseInt(mT[1]);
//         timeHrs = secs / 3600;
//         timeStr = formatSecs(secs);
//       }
//     }

//     // PrusaSlicer / OrcaSlicer / Bambu: ; estimated printing time ... = 1h 23m 45s
//     if (!timeHrs) {
//       const mTime = t.match(/;\s*estimated\s+printing\s+time.*?=\s*(.+)/i);
//       if (mTime) {
//         timeStr = mTime[1].trim();
//         timeHrs = parseTimeStr(timeStr);
//       }
//     }

//     // Layer count
//     if (!layers) {
//       const mL = t.match(/;\s*(?:total\s+)?layers?\s*(?:count\s*)?[:=]\s*(\d+)/i);
//       if (mL) layers = parseInt(mL[1]);
//     }
//   }

//   if (totalWeightG > 0) weight = totalWeightG;

//   console.log('Parsed: weight=', weight, 'timeHrs=', timeHrs, 'timeStr=', timeStr);

//   // Correction factor calibrate กับ Bambu PLA Basic จริง 4 จุด:
//   //   infill 15%: 44.26 / 32.7  = 1.353
//   //   infill 25%: 54.07 / 36.65 = 1.476
//   //   infill 50%: 78.50 / 45.6  = 1.721
//   //   infill 80%: 107.44 / 57.25 = 1.877
//   const infillNum = parseInt(infill) || 25;
//   let WEIGHT_CORRECTION;
//   if (infillNum <= 15)       WEIGHT_CORRECTION = 1.353;
//   else if (infillNum <= 25)  WEIGHT_CORRECTION = 1.353 + (infillNum - 15) / 10 * (1.476 - 1.353);
//   else if (infillNum <= 50)  WEIGHT_CORRECTION = 1.476 + (infillNum - 25) / 25 * (1.721 - 1.476);
//   else if (infillNum <= 80)  WEIGHT_CORRECTION = 1.721 + (infillNum - 50) / 30 * (1.877 - 1.721);
//   else                       WEIGHT_CORRECTION = 1.877;
//   if (weight) weight = weight * WEIGHT_CORRECTION;

//   // Time correction calibrate จาก 4 จุด:
//   //   infill 15%: 6h48m / 7h16m  = 0.934
//   //   infill 25%: ตรงแล้ว        = 1.000
//   //   infill 50%: 11h12m / 10h48m = 1.037
//   //   infill 80%: 14h53m / 10h39m = 1.400
//   let TIME_CORRECTION;
//   if (infillNum <= 15)       TIME_CORRECTION = 0.934;
//   else if (infillNum <= 25)  TIME_CORRECTION = 0.934 + (infillNum - 15) / 10 * (1.000 - 0.934);
//   else if (infillNum <= 50)  TIME_CORRECTION = 1.000 + (infillNum - 25) / 25 * (1.037 - 1.000);
//   else if (infillNum <= 80)  TIME_CORRECTION = 1.037 + (infillNum - 50) / 30 * (1.400 - 1.037);
//   else                       TIME_CORRECTION = 1.400;
//   if (timeHrs) timeHrs = timeHrs * TIME_CORRECTION;

//   if (!weight && !timeHrs) throw new Error('ไม่สามารถ parse ข้อมูลจาก gcode ได้');
//   if (!weight) weight = 0;
//   if (!timeHrs) timeHrs = 0;

//   return {
//     weight:    Math.round(weight * 100) / 100,
//     timeHrs:   Math.round(timeHrs * 100) / 100,
//     timeStr:   formatSecs(Math.round(timeHrs * 3600)), // format จาก corrected timeHrs เสมอ
//     filamentM: filamentM ? Math.round(filamentM * 100) / 100 : null,
//     layers:    layers || null,
//   };
// }

// // ===== HELPERS =====
// function runCommand(cmd, timeout = 60000) {
//   return new Promise((resolve, reject) => {
//     const proc = exec(cmd, { timeout }, (err, stdout, stderr) => {
//       if (err) reject(new Error(stderr || err.message));
//       else resolve(stdout);
//     });
//   });
// }

// function parseTimeStr(str) {
//   // "1h 23m 45s" or "23m 45s" or "45s"
//   let hrs = 0, mins = 0, secs = 0;
//   const hm = str.match(/(\d+)h/); if (hm) hrs  = parseInt(hm[1]);
//   const mm = str.match(/(\d+)m/); if (mm) mins = parseInt(mm[1]);
//   const sm = str.match(/(\d+)s/); if (sm) secs = parseInt(sm[1]);
//   return hrs + mins / 60 + secs / 3600;
// }

// function formatSecs(totalSecs) {
//   const h = Math.floor(totalSecs / 3600);
//   const m = Math.floor((totalSecs % 3600) / 60);
//   const s = totalSecs % 60;
//   let str = '';
//   if (h) str += `${h}h `;
//   if (m) str += `${m}m `;
//   str += `${s}s`;
//   return str.trim();
// }

// // ===== START =====
// app.listen(PORT, () => {
//   console.log(`Print3DHub Slicer API running on port ${PORT}`);
//   console.log(`OrcaSlicer binary: ${ORCA_BIN}`);
// });
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

// ===== SLICE QUEUE =====
// slice ทีละ 1 งานเพื่อป้องกัน RAM เกิน (PrusaSlicer ใช้ ~500MB/process)
let sliceRunning = false;
const sliceQueue = [];

function processQueue() {
  if (sliceRunning || sliceQueue.length === 0) return;
  sliceRunning = true;
  const { task, resolve, reject } = sliceQueue.shift();
  console.log(`Queue: running task (${sliceQueue.length} remaining)`);
  task().then(resolve).catch(reject).finally(() => {
    sliceRunning = false;
    processQueue(); // รัน task ถัดไป
  });
}

function enqueueSlice(task) {
  return new Promise((resolve, reject) => {
    sliceQueue.push({ task, resolve, reject });
    console.log(`Queue: added task (queue size: ${sliceQueue.length})`);
    processQueue();
  });
}

// ===== MULTER — รับไฟล์ upload =====
const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `upload-${Date.now()}${ext}`);
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
  res.json({ status: 'ok', version: '1.0.0', queue: sliceQueue.length, busy: sliceRunning });
});

// ===== QUEUE STATUS =====
app.get('/queue', (req, res) => {
  res.json({ queue: sliceQueue.length, busy: sliceRunning });
});

// ===== SLICE ENDPOINT =====
app.post('/slice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });

  // ถ้า queue เต็มเกิน 5 งาน ปฏิเสธทันที
  if (sliceQueue.length >= 5) {
    try { fs.unlinkSync(req.file.path); } catch {}
    return res.status(503).json({ error: 'Server ยุ่งมาก กรุณาลองใหม่ใน 2-3 นาที' });
  }

  const { material='PLA', layer='0.16', infill='25', scale_x='1', scale_y='1', scale_z='1', support_material='0' } = req.body;
  const inputFile = req.file.path;

  try {
    const result = await enqueueSlice(() => runSlice(inputFile, { material, layer, infill, scale_x, scale_y, scale_z, support_material }));
    res.json(result);
  } catch (err) {
    console.error('Slice error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    try { fs.unlinkSync(inputFile); } catch {}
  }
});

async function runSlice(inputFile, { material, layer, infill, scale_x, scale_y, scale_z, support_material='0' }) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-'));
  const gcodeFile = path.join(outputDir, 'output.gcode');

  try {
    const infillPct = parseInt(infill);
    const sx = parseFloat(scale_x), sy = parseFloat(scale_y), sz = parseFloat(scale_z);

    const scaleArg = (sx !== 1 || sy !== 1 || sz !== 1)
      ? `--scale ${sx * 100},${sy * 100},${sz * 100}`
      : '';

    // Support material — รับจาก frontend (default: ปิด เพื่อตรงกับ Bambu Studio ที่ไม่เปิด support)
    const useSupport = support_material === '1' || support_material === 'true';
    const supportArgs = useSupport
      ? '--support-material --support-material-auto --support-material-threshold 45'
      : '';

    const layerMM = layer || '0.16';

    const cmd = [
      'prusa-slicer',
      '--export-gcode',
      `--layer-height ${layerMM}`,
      `--fill-density ${infillPct}%`,
      `--fill-pattern grid`,
      supportArgs,
      scaleArg,
      '--output', `"${gcodeFile}"`,
      `"${inputFile}"`
    ].filter(Boolean).join(' ');

    console.log('Running slicer:', cmd);
    const timeout = useSupport ? 180000 : 120000;
    await runCommand(cmd, timeout);

    const result = parseGcode(gcodeFile, infill);
    return {
      success: true,
      weight_g: result.weight,
      print_time_hrs: result.timeHrs,
      print_time_str: result.timeStr,
      filament_m: result.filamentM,
      layer_count: result.layers,
    };

  } finally {
    try { fs.rmSync(outputDir, { recursive: true }); } catch {}
  }
}

// ===== PARSE GCODE =====
function parseGcode(gcodeFile, infill = '25') {
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

  // ===== WEIGHT CORRECTION =====
  // Calibrate จาก Bambu P1P จริง vs PrusaSlicer (no support):
  //   infill 15%: ratio ≈ 1.85  (extrapolated)
  //   infill 25%: Bambu 48.86g / Prusa 24.63g = 1.985  ← measured
  //   infill 50%: ratio ≈ 2.10  (extrapolated)
  //   infill 80%: ratio ≈ 2.25  (extrapolated)
  // หมายเหตุ: ต่างกันเพราะ Bambu ใช้ gyroid infill + wall density ต่างกัน
  const infillNum = parseInt(infill) || 25;
  let WEIGHT_CORRECTION;
  if (infillNum <= 15)       WEIGHT_CORRECTION = 1.850;
  else if (infillNum <= 25)  WEIGHT_CORRECTION = 1.850 + (infillNum - 15) / 10 * (1.985 - 1.850);
  else if (infillNum <= 50)  WEIGHT_CORRECTION = 1.985 + (infillNum - 25) / 25 * (2.100 - 1.985);
  else if (infillNum <= 80)  WEIGHT_CORRECTION = 2.100 + (infillNum - 50) / 30 * (2.250 - 2.100);
  else                       WEIGHT_CORRECTION = 2.250;
  if (weight) weight = weight * WEIGHT_CORRECTION;

  // ===== TIME CORRECTION =====
  // Bambu P1P พิมพ์เร็วกว่า Prusa estimate เพราะ input shaping + high speed
  // calibrate: Bambu 2h8m vs Prusa 5h8m at infill 25% → ratio ≈ 0.415
  let TIME_CORRECTION;
  if (infillNum <= 15)       TIME_CORRECTION = 0.400;
  else if (infillNum <= 25)  TIME_CORRECTION = 0.400 + (infillNum - 15) / 10 * (0.415 - 0.400);
  else if (infillNum <= 50)  TIME_CORRECTION = 0.415 + (infillNum - 25) / 25 * (0.430 - 0.415);
  else if (infillNum <= 80)  TIME_CORRECTION = 0.430 + (infillNum - 50) / 30 * (0.450 - 0.430);
  else                       TIME_CORRECTION = 0.450;
  if (timeHrs) timeHrs = timeHrs * TIME_CORRECTION;

  if (!weight && !timeHrs) throw new Error('ไม่สามารถ parse ข้อมูลจาก gcode ได้');
  if (!weight) weight = 0;
  if (!timeHrs) timeHrs = 0;

  return {
    weight:    Math.round(weight * 100) / 100,
    timeHrs:   Math.round(timeHrs * 100) / 100,
    timeStr:   formatSecs(Math.round(timeHrs * 3600)), // format จาก corrected timeHrs เสมอ
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
