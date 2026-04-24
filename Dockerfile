# ===== Print3DHub Slicer Backend =====
# ใช้ PrusaSlicer แทน OrcaSlicer เพราะ headless ได้ดีกว่าบน Linux server
FROM ubuntu:22.04

# ป้องกัน interactive prompt ระหว่าง apt install
ENV DEBIAN_FRONTEND=noninteractive

# ติดตั้ง Node.js 20
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs

# ติดตั้ง PrusaSlicer และ dependencies ทั้งหมด
RUN apt-get update && apt-get install -y \
    prusa-slicer \
    libgl1-mesa-glx \
    libglu1-mesa \
    libegl1-mesa \
    libgles2-mesa \
    libgbm1 \
    xvfb \
    libdbus-1-3 \
    libglib2.0-0 \
    libfontconfig1 \
    libxrender1 \
    libxi6 \
    libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Node.js app
COPY package*.json ./
RUN npm ci --only=production

COPY server.js ./
COPY profiles/ ./profiles/

ENV PORT=3000
ENV ORCA_BIN=prusa-slicer
ENV NODE_ENV=production
ENV LIBGL_ALWAYS_SOFTWARE=1

EXPOSE 3000

CMD ["sh", "-c", "xvfb-run --auto-servernum node server.js"]
