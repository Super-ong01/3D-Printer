# ===== Stage 1: Download OrcaSlicer =====
FROM ubuntu:22.04 AS orca-download

RUN apt-get update && apt-get install -y curl wget ca-certificates && rm -rf /var/lib/apt/lists/*

ARG ORCA_VERSION=2.1.1
RUN wget -q "https://github.com/SoftFever/OrcaSlicer/releases/download/v${ORCA_VERSION}/OrcaSlicer_Linux_V${ORCA_VERSION}.AppImage" \
    -O /orca-slicer.AppImage && chmod +x /orca-slicer.AppImage

RUN /orca-slicer.AppImage --appimage-extract && \
    mv squashfs-root /orca-slicer-extracted

# ===== Stage 2: Node.js App =====
FROM node:20-slim

# ติดตั้ง libraries ทั้งหมดที่ OrcaSlicer ต้องการ รวมถึง libEGL, Mesa, OpenGL
RUN apt-get update && apt-get install -y \
    libgl1 \
    libgl1-mesa-glx \
    libgles2 \
    libegl1 \
    libegl1-mesa \
    libgbm1 \
    libglib2.0-0 \
    libdbus-1-3 \
    libx11-6 libxext6 libxrender1 \
    libxcb1 libxcb-glx0 \
    libxi6 libxrandr2 libxss1 \
    libfontconfig1 libfreetype6 \
    libstdc++6 libgcc-s1 \
    xvfb \
    mesa-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=orca-download /orca-slicer-extracted /app/orca-slicer
RUN ln -s /app/orca-slicer/AppRun /usr/local/bin/orca-slicer

COPY package*.json ./
RUN npm ci --only=production

COPY server.js ./
COPY profiles/ ./profiles/

ENV PORT=3000
ENV ORCA_BIN=/usr/local/bin/orca-slicer
ENV NODE_ENV=production
# บอก Mesa ให้ใช้ software rendering แทน GPU (เพราะ Railway ไม่มี GPU)
ENV LIBGL_ALWAYS_SOFTWARE=1
ENV GALLIUM_DRIVER=llvmpipe

EXPOSE 3000

CMD ["sh", "-c", "xvfb-run --auto-servernum --server-args='-screen 0 1024x768x24' node server.js"]
