const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = path.join(__dirname, "uploads");
const OUTPUT_DIR = path.join(__dirname, "output");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: 500 * 1024 * 1024
  }
});

app.use(express.static("public"));
app.use("/hls", express.static(OUTPUT_DIR));

app.post("/convert", upload.single("video"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      error: "動画ファイルがありません"
    });
  }

  const jobId = crypto.randomUUID();

  const jobDir = path.join(OUTPUT_DIR, jobId);

  fs.mkdirSync(jobDir, { recursive: true });

  const inputPath = req.file.path;
  const playlistPath = path.join(jobDir, "playlist.m3u8");
  const segmentPath = path.join(jobDir, "segment_%03d.ts");

  const args = [
    "-y",
    "-i",
    inputPath,

    "-c:v",
    "libx264",

    "-preset",
    "veryfast",

    "-crf",
    "23",

    "-c:a",
    "aac",

    "-b:a",
    "128k",

    "-hls_time",
    "6",

    "-hls_playlist_type",
    "vod",

    "-hls_segment_filename",
    segmentPath,

    playlistPath
  ];

  const ffmpeg = spawn("ffmpeg", args);

  let errorOutput = "";

  ffmpeg.stderr.on("data", (data) => {
    errorOutput += data.toString();
  });

  ffmpeg.on("close", (code) => {
    try {
      fs.unlinkSync(inputPath);
    } catch {}

    if (code !== 0) {
      console.error(errorOutput);

      try {
        fs.rmSync(jobDir, {
          recursive: true,
          force: true
        });
      } catch {}

      return res.status(500).json({
        error: "FFmpegによる変換に失敗しました"
      });
    }

    res.json({
      success: true,
      playlist: `/hls/${jobId}/playlist.m3u8`,
      jobId
    });
  });

  ffmpeg.on("error", (error) => {
    console.error(error);

    try {
      fs.unlinkSync(inputPath);
    } catch {}

    res.status(500).json({
      error: "FFmpegを起動できませんでした"
    });
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server started on port ${PORT}`);
});
