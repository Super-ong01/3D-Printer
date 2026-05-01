const express    = require('express');
const multer     = require('multer');
const cors       = require('cors');
const { exec }   = require('child_process');
const path       = require('path');
const fs         = require('fs');
const os         = require('os');
const mongoose   = require('mongoose');
const jwt        = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const cloudinary = require('cloudinary').v2;

const app  = express();
const PORT = process.env.PORT || 3000;

// ===== ENV =====
const MONGODB_URI            = process.env.MONGODB_URI;
const JWT_SECRET             = process.env.JWT_SECRET             || 'changeme_please';
const GOOGLE_CLIENT_ID       = process.env.GOOGLE_CLIENT_ID;
const CLOUDINARY_CLOUD_NAME  = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY     = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET  = process.env.CLOUDINARY_API_SECRET;

// ===== CLOUDINARY =====
if (CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key:    CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  console.log('[Cloudinary] configured');
} else {
  console.warn('[Cloudinary] not configured — file upload disabled');
}

// ===== CORS =====
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','DELETE','OPTIONS'] }));
app.use(express.json());

// ===== MONGODB =====
if (MONGODB_URI) {
  mongoose.connect(MONGODB_URI)
    .then(() => console.log('[DB] MongoDB connected'))
    .catch(e => console.error('[DB] Error:', e.message));
} else {
  console.warn('[DB] MONGODB_URI not set — auth disabled');
}

// ===== SCHEMAS =====
const userSchema = new mongoose.Schema({
  googleId:  { type: String, unique: true, sparse: true },
  email:     { type: String, unique: true, sparse: true },
  name:      String,
  phone:     { type: String, default: '' },
  picture:   String,
  role:      { type: String, default: 'user' },
  addresses: [{ label: String, name: String, phone: String, addr: String }],
  createdAt: { type: Date, default: Date.now },
});

const orderSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  orderId:  String,
  files:    String,
  fileUrls: [{ name: String, url: String }],  // เพิ่ม field นี้
  perFileDetails: [{ name: String, url: String, qty: Number, tech: String, material: String, color: String, infill: Number, layer: String, price: Number, size: String }], // settings แยกตามไฟล์
  slipUrl:  String,   // URL สลิปการโอนเงิน
  slipUploadedAt: Date, // เวลาที่ส่งสลิป
  shipping: { type: Number, default: 0 },  // ค่าส่ง
  shippingMethod: String,                   // วิธีจัดส่ง
  tech:     String,
  material: String,
  color:    String,
  size:     String,
  qty:      Number,
  price:    Number,
  infill:   Number,
  layer:    String,
  note:     String,
  coupon:   String,
  status:   { type: String, default: 'pending' },
  name:     String,
  phone:    String,
  addr:     String,
  createdAt:{ type: Date, default: Date.now },
});

const quoteSchema = new mongoose.Schema({
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  quoteId:  String,
  files:    String,
  tech:     String,
  material: String,
  size:     String,
  qty:      Number,
  price:    Number,
  status:   { type: String, default: 'draft' },
  createdAt:{ type: Date, default: Date.now },
});

const User  = mongoose.model('User',  userSchema);
const Order = mongoose.model('Order', orderSchema);
const Quote = mongoose.model('Quote', quoteSchema);

// ===== AUTH MIDDLEWARE =====
function auth(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ===== GOOGLE LOGIN =====
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

app.post('/auth/google', async (req, res) => {
  if (!googleClient) return res.status(503).json({ error: 'Google auth not configured' });
  const { credential } = req.body;
  if (!credential) return res.status(400).json({ error: 'No credential' });
  try {
    const ticket  = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const { sub: googleId, email, name, picture } = ticket.getPayload();

    let user = await User.findOne({ googleId }) || await User.findOne({ email });
    if (!user) {
      user = await User.create({ googleId, email, name, picture });
    } else {
      user.googleId = googleId; user.name = name; user.picture = picture;
      await user.save();
    }

    const token = jwt.sign(
      { id: user._id, email: user.email, name: user.name, role: user.role, picture: user.picture },
      JWT_SECRET, { expiresIn: '30d' }
    );
    res.json({ token, user: { id: user._id, email: user.email, name: user.name, role: user.role, picture: user.picture, phone: user.phone } });
  } catch (e) {
    console.error('[Auth] Google error:', e.message);
    res.status(401).json({ error: 'Invalid Google token' });
  }
});

// GET /auth/me
app.get('/auth/me', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-__v');
    if (!user) return res.status(404).json({ error: 'Not found' });
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /user/profile
app.put('/user/profile', auth, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.user.id, { name: req.body.name, phone: req.body.phone }, { new: true }).select('-__v');
    res.json(user);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== ADDRESSES =====
app.get('/user/addresses', auth, async (req, res) => {
  try { const u = await User.findById(req.user.id); res.json(u.addresses || []); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/user/addresses', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user.id);
    u.addresses.push(req.body); await u.save(); res.json(u.addresses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/user/addresses/:idx', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user.id);
    u.addresses.splice(parseInt(req.params.idx), 1); await u.save(); res.json(u.addresses);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== ORDERS =====
app.post('/orders', auth, async (req, res) => {
  try { const o = await Order.create({ ...req.body, userId: req.user.id }); res.json(o); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/orders', auth, async (req, res) => {
  try { res.json(await Order.find({ userId: req.user.id }).sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== QUOTES =====
app.post('/quotes', auth, async (req, res) => {
  try { const q = await Quote.create({ ...req.body, userId: req.user.id }); res.json(q); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/quotes', auth, async (req, res) => {
  try { res.json(await Quote.find({ userId: req.user.id }).sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ===== ADMIN =====
app.get('/admin/orders', auth, adminOnly, async (req, res) => {
  try { res.json(await Order.find().sort({ createdAt: -1 }).populate('userId','name email phone')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/orders/:id/status', auth, adminOnly, async (req, res) => {
  try { res.json(await Order.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/admin/users', auth, adminOnly, async (req, res) => {
  try { res.json(await User.find().select('-__v').sort({ createdAt: -1 })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/admin/users/:id/role', auth, adminOnly, async (req, res) => {
  try { res.json(await User.findByIdAndUpdate(req.params.id, { role: req.body.role }, { new: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// multer สำหรับ STL/STEP/3MF
const uploadStorage = multer.memoryStorage();
const fileUpload = multer({
  storage: uploadStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.stl','.step','.3mf','.obj'].includes(ext)) cb(null, true);
    else cb(new Error('ไฟล์ต้องเป็น STL, STEP, 3MF หรือ OBJ เท่านั้น'));
  }
});

// multer แยกสำหรับสลิป (รูปภาพ)
const slipUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('ไฟล์ต้องเป็นรูปภาพเท่านั้น'));
  }
});

app.post('/upload-file', fileUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
  if (!CLOUDINARY_CLOUD_NAME) return res.status(503).json({ error: 'Cloudinary not configured' });

  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          resource_type: 'raw',
          folder: 'print3dhub/orders',
          public_id: `${Date.now()}_${req.file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_')}`,
          use_filename: true,
          unique_filename: false,
        },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    res.json({
      success: true,
      url: result.secure_url,
      public_id: result.public_id,
      filename: req.file.originalname,
      size: req.file.size,
    });
  } catch (e) {
    console.error('[Upload] Cloudinary error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /upload-slip — ลูกค้าส่งสลิปการโอนเงิน
app.post('/upload-slip', auth, slipUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์สลิป' });
  if (!CLOUDINARY_CLOUD_NAME) return res.status(503).json({ error: 'Cloudinary not configured' });
  try {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { resource_type: 'image', folder: 'print3dhub/slips',
          public_id: `slip_${req.body.orderId||Date.now()}` },
        (error, result) => { if (error) reject(error); else resolve(result); }
      );
      stream.end(req.file.buffer);
    });
    // อัปเดต order ใน MongoDB
    if (req.body.mongoId) {
      await Order.findByIdAndUpdate(req.body.mongoId, {
        slipUrl: result.secure_url,
        slipUploadedAt: new Date(),
      });
    }
    res.json({ success: true, url: result.secure_url });
  } catch (e) {
    console.error('[Slip Upload] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// PUT /admin/orders/:id/confirm-payment — Admin ยืนยันการชำระเงิน
app.put('/admin/orders/:id/confirm-payment', auth, adminOnly, async (req, res) => {
  try {
    res.json(await Order.findByIdAndUpdate(req.params.id, { status: 'confirmed' }, { new: true }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// =====================================================================
let sliceRunning = false;
const sliceQueue = [];

function processQueue() {
  if (sliceRunning || sliceQueue.length === 0) return;
  sliceRunning = true;
  const { task, resolve, reject } = sliceQueue.shift();
  console.log(`Queue: running task (${sliceQueue.length} remaining)`);
  task().then(resolve).catch(reject).finally(() => { sliceRunning = false; processQueue(); });
}

function enqueueSlice(task) {
  return new Promise((resolve, reject) => {
    sliceQueue.push({ task, resolve, reject });
    console.log(`Queue: added task (queue size: ${sliceQueue.length})`);
    processQueue();
  });
}

const storage = multer.diskStorage({
  destination: os.tmpdir(),
  filename: (req, file, cb) => { cb(null, `upload-${Date.now()}${path.extname(file.originalname).toLowerCase()}`); }
});

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['.stl','.step','.3mf'].includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('ไฟล์ต้องเป็น STL, STEP หรือ 3MF'));
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', version: '2.0.0', queue: sliceQueue.length, busy: sliceRunning, db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' });
});

app.get('/queue', (req, res) => res.json({ queue: sliceQueue.length, busy: sliceRunning }));

app.post('/slice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
  if (sliceQueue.length >= 5) { try { fs.unlinkSync(req.file.path); } catch {} return res.status(503).json({ error: 'Server ยุ่งมาก' }); }
  const { material='PLA', layer='0.16', infill='25', scale_x='1', scale_y='1', scale_z='1', support_material='0' } = req.body;
  try {
    const result = await enqueueSlice(() => runSlice(req.file.path, { material, layer, infill, scale_x, scale_y, scale_z, support_material }));
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
  finally { try { fs.unlinkSync(req.file.path); } catch {} }
});

async function runSlice(inputFile, { layer, infill, scale_x, scale_y, scale_z, support_material='0' }) {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slice-'));
  const gcodeFile = path.join(outputDir, 'output.gcode');
  try {
    const infillPct = parseInt(infill);
    const sx = parseFloat(scale_x), sy = parseFloat(scale_y), sz = parseFloat(scale_z);
    const scaleArg  = (sx!==1||sy!==1||sz!==1) ? `--scale ${sx*100},${sy*100},${sz*100}` : '';
    const useSupport = support_material==='1'||support_material==='true';
    const supArgs   = useSupport ? '--support-material --support-material-auto --support-material-threshold 45' : '';
    const cmd = ['prusa-slicer','--export-gcode',`--layer-height ${layer||'0.16'}`,`--fill-density ${infillPct}%`,'--fill-pattern grid',supArgs,scaleArg,'--output',`"${gcodeFile}"`,`"${inputFile}"`].filter(Boolean).join(' ');
    console.log('Running slicer:', cmd);
    await runCommand(cmd, useSupport ? 180000 : 120000);
    const r = parseGcode(gcodeFile, infill);
    return { success:true, weight_g:r.weight, print_time_hrs:r.timeHrs, print_time_str:r.timeStr, filament_m:r.filamentM, layer_count:r.layers };
  } finally { try { fs.rmSync(outputDir,{recursive:true}); } catch {} }
}

function parseGcode(gcodeFile, infill='25') {
  if (!fs.existsSync(gcodeFile)) throw new Error('ไม่พบไฟล์ gcode');
  const lines = fs.readFileSync(gcodeFile,'utf8').split('\n');
  let totalWeightG=0, timeHrs=null, timeStr=null, filamentM=null, layers=null;
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith(';')) continue;
    const mG=t.match(/;\s*filament\s+used\s*\[g\]\s*=\s*([\d.]+)/i); if(mG) totalWeightG+=parseFloat(mG[1]);
    if(!totalWeightG){const m=t.match(/;\s*filament\s+used\s*\[mm3?\]\s*=\s*([\d.]+)/i);if(m)totalWeightG+=parseFloat(m[1])*1.24/1000;}
    if(!totalWeightG){const m=t.match(/;\s*filament\s+used\s*\[cm3?\]\s*=\s*([\d.]+)/i);if(m)totalWeightG+=parseFloat(m[1])*1.24;}
    if(!filamentM){const m=t.match(/;Filament\s+used:\s*([\d.]+)m$/i);if(m){filamentM=parseFloat(m[1]);if(!totalWeightG)totalWeightG=filamentM*Math.PI*(0.0875**2)*100*1.24;}}
    if(!timeHrs){const m=t.match(/^;TIME:(\d+)$/);if(m){const s=parseInt(m[1]);timeHrs=s/3600;timeStr=formatSecs(s);}}
    if(!timeHrs){const m=t.match(/;\s*estimated\s+printing\s+time.*?=\s*(.+)/i);if(m){timeStr=m[1].trim();timeHrs=parseTimeStr(timeStr);}}
    if(!layers){const m=t.match(/;\s*(?:total\s+)?layers?\s*(?:count\s*)?[:=]\s*(\d+)/i);if(m)layers=parseInt(m[1]);}
  }
  let weight=totalWeightG>0?totalWeightG:null;
  console.log('Parsed: weight=',weight,'timeHrs=',timeHrs);
  const n=parseInt(infill)||25;
  const WC = n<=15?1.850:n<=25?1.850+(n-15)/10*0.135:n<=50?1.985+(n-25)/25*0.115:n<=80?2.100+(n-50)/30*0.150:2.250;
  const TC = n<=15?0.400:n<=25?0.400+(n-15)/10*0.015:n<=50?0.415+(n-25)/25*0.015:n<=80?0.430+(n-50)/30*0.020:0.450;
  if(weight)weight*=WC; if(timeHrs)timeHrs*=TC;
  if(!weight&&!timeHrs)throw new Error('ไม่สามารถ parse gcode');
  return { weight:Math.round((weight||0)*100)/100, timeHrs:Math.round((timeHrs||0)*100)/100, timeStr:formatSecs(Math.round((timeHrs||0)*3600)), filamentM:filamentM?Math.round(filamentM*100)/100:null, layers:layers||null };
}

function runCommand(cmd,timeout=60000){return new Promise((res,rej)=>exec(cmd,{timeout},(e,out,err)=>e?rej(new Error(err||e.message)):res(out)));}
function parseTimeStr(s){let h=0,m=0,sec=0;const hm=s.match(/(\d+)h/);if(hm)h=+hm[1];const mm=s.match(/(\d+)m/);if(mm)m=+mm[1];const sm=s.match(/(\d+)s/);if(sm)sec=+sm[1];return h+m/60+sec/3600;}
function formatSecs(t){const h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60;return[h&&`${h}h`,m&&`${m}m`,`${s}s`].filter(Boolean).join(' ');}

app.listen(PORT, () => console.log(`Print3DHub API v2 on port ${PORT}`));
