# Print3DHub — Slicer Backend API

Backend สำหรับ slice ไฟล์ 3D และคืนค่าน้ำหนักและเวลาพิมพ์จริงจาก OrcaSlicer

---

## วิธี Deploy บน Railway (แนะนำ)

### ขั้นตอนที่ 1 — สมัคร Railway
1. ไปที่ https://railway.app
2. Sign up ด้วย GitHub
3. เลือก **New Project → Deploy from GitHub**

### ขั้นตอนที่ 2 — Push โค้ดขึ้น GitHub
```bash
cd print3d-backend
git init
git add .
git commit -m "initial backend"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/print3d-backend.git
git push -u origin main
```

### ขั้นตอนที่ 3 — Connect Railway กับ GitHub
1. Railway Dashboard → **New Project**
2. เลือก **Deploy from GitHub repo**
3. เลือก repo `print3d-backend`
4. Railway จะ detect Dockerfile อัตโนมัติ

### ขั้นตอนที่ 4 — ตั้งค่า Environment Variables
ใน Railway Dashboard → Variables → เพิ่ม:
```
ALLOWED_ORIGIN=https://your-frontend-domain.com
NODE_ENV=production
```

### ขั้นตอนที่ 5 — Deploy
Railway จะ build Docker image และ deploy อัตโนมัติ ใช้เวลาประมาณ 5-10 นาที

---

## API Reference

### GET /health
ตรวจสอบสถานะ server
```json
{ "status": "ok", "version": "1.0.0" }
```

### POST /slice
Slice ไฟล์ 3D และคืนค่าน้ำหนักและเวลาพิมพ์

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| file | File | ✓ | STL, STEP, หรือ 3MF ไม่เกิน 100MB |
| material | string | | PLA, PETG, ASA, TPU, Standard, H-Clear, ABS-Like, Tough |
| layer | string | | 0.08, 0.16, 0.24 |
| infill | string | | 15, 25, 50, 80 |
| scale_x | string | | scale แกน X (default: 1) |
| scale_y | string | | scale แกน Y (default: 1) |
| scale_z | string | | scale แกน Z (default: 1) |

**Response:**
```json
{
  "success": true,
  "weight_g": 12.34,
  "print_time_hrs": 1.45,
  "print_time_str": "1h 27m 0s",
  "filament_m": 4.12,
  "layer_count": 432
}
```

**Error Response:**
```json
{
  "error": "ไม่สามารถ slice ไฟล์ได้"
}
```

---

## การเชื่อมกับ Frontend

เพิ่มโค้ดนี้ใน `print3d_quote.html` แทนการคำนวณ mock:

```javascript
async function sliceFile(file, settings) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('material', settings.material);
  formData.append('layer', settings.layer);
  formData.append('infill', settings.infill);
  formData.append('scale_x', settings.scaleX);
  formData.append('scale_y', settings.scaleY);
  formData.append('scale_z', settings.scaleZ);

  const res = await fetch('https://YOUR-RAILWAY-URL.railway.app/slice', {
    method: 'POST',
    body: formData
  });

  if (!res.ok) throw new Error('Slice failed');
  return await res.json();
  // { weight_g, print_time_hrs, ... }
}
```

---

## โครงสร้างไฟล์

```
print3d-backend/
├── server.js          ← Express API server
├── package.json       ← Dependencies
├── Dockerfile         ← Docker build (Railway ใช้)
├── railway.toml       ← Railway config
├── .env.example       ← Environment variables template
└── profiles/          ← OrcaSlicer profiles
    ├── bambu_p1p.json           ← Printer profile
    ├── layer_ultra_fine.json    ← 0.08mm
    ├── layer_optimal.json       ← 0.16mm
    ├── layer_coarse.json        ← 0.24mm
    ├── filament_pla.json
    ├── filament_petg.json
    ├── filament_asa.json
    ├── filament_tpu.json
    ├── resin_standard.json
    ├── resin_hclear.json
    ├── resin_abslike.json
    └── resin_tough.json
```

---

## Export Profile จาก Bambu Studio จริง (แนะนำ)

Profile ใน `profiles/` เป็นแค่ตัวอย่าง ควร export จาก Bambu Studio จริงๆ:

1. เปิด Bambu Studio
2. ตั้งค่า printer = P1P, filament = PLA, layer = 0.16mm
3. File → Export → Export Config Bundle
4. แทนที่ไฟล์ใน `profiles/` ด้วยไฟล์ที่ export มา

---

## ค่าใช้จ่าย Railway

| แผน | ราคา | เหมาะสำหรับ |
|-----|------|-------------|
| Trial | ฟรี $5 | ทดสอบ 1 เดือน |
| Hobby | $5/เดือน | ใช้งานจริง |
| Pro | $20/เดือน | ถ้ามีลูกค้าเยอะ |

> OrcaSlicer ใช้ CPU มาก (~5-30 วินาที/ไฟล์) ถ้า slice เกิน 500 ครั้ง/เดือนอาจโดน overage
