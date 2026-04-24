# ===== Stage 1: Download OrcaSlicer =====
FROM ubuntu:22.04 AS orca-download

RUN apt-get update && apt-get install -y curl wget ca-certificates && rm -rf /var/lib/apt/lists/*

# Download OrcaSlicer AppImage (Linux headless)
# เปลี่ยน version ได้ที่ https://github.com/SoftFever/OrcaSlicer/releases
ARG ORCA_VERSION=2.1.1
RUN wget -q "https://github.com/SoftFever/OrcaSlicer/releases/download/v${ORCA_VERSION}/OrcaSlicer_Linux_V${ORCA_VERSION}.AppImage" \
    -O /orca-slicer.AppImage && chmod +x /orca-slicer.AppImage

# Extract AppImage เพื่อรันได้โดยไม่ต้อง FUSE
RUN /orca-slicer.AppImage --appimage-extract && \
    mv squashfs-root /orca-slicer-extracted

# ===== Stage 2: Node.js App =====
FROM node:20-slim

# Dependencies สำหรับ OrcaSlicer GUI-less
RUN apt-get update && apt-get install -y \
    libgl1 libglib2.0-0 libdbus-1-3 \
    libx11-6 libxext6 libxrender1 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy OrcaSlicer
COPY --from=orca-download /orca-slicer-extracted /app/orca-slicer
RUN ln -s /app/orca-slicer/AppRun /usr/local/bin/orca-slicer

# Copy Node.js app
COPY package*.json ./
RUN npm ci --only=production

COPY server.js ./
COPY profiles/ ./profiles/

# Environment
ENV PORT=3000
ENV ORCA_BIN=/usr/local/bin/orca-slicer
ENV NODE_ENV=production

EXPOSE 3000

# ใช้ xvfb-run เพราะ OrcaSlicer ต้องการ display แม้จะ headless
CMD ["sh", "-c", "xvfb-run --auto-servernum --server-args='-screen 0 1024x768x24' node server.js"]
