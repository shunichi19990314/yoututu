FROM node:20-bookworm-slim

# FFmpeg、Python、yt-dlpに必要なものをインストール
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        python3 \
        python3-pip \
        ca-certificates && \
    python3 -m pip install \
        --break-system-packages \
        --no-cache-dir \
        -U yt-dlp && \
    rm -rf /var/lib/apt/lists/*

# yt-dlpとFFmpegがインストールされていることを確認
RUN yt-dlp --version && \
    ffmpeg -version

# アプリケーション
WORKDIR /app

# package.jsonを先にコピー
COPY package*.json ./

# Node.jsパッケージをインストール
RUN npm install --omit=dev

# アプリケーション本体
COPY . .

# 保存用ディレクトリ
RUN mkdir -p /app/downloads /app/output

# 本番環境
ENV NODE_ENV=production

# Renderから渡されるPORTをserver.jsで使用
CMD ["npm", "start"]
