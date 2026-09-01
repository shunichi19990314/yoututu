const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");

const app = express();

const PORT = process.env.PORT || 3000;

const DOWNLOAD_DIR = path.join(__dirname, "downloads");
const OUTPUT_DIR = path.join(__dirname, "output");

fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

app.use(
  "/hls",
  express.static(OUTPUT_DIR, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith(".m3u8")) {
        res.setHeader(
          "Content-Type",
          "application/vnd.apple.mpegurl"
        );

        res.setHeader(
          "Cache-Control",
          "no-cache"
        );
      }

      if (filePath.endsWith(".ts")) {
        res.setHeader(
          "Content-Type",
          "video/mp2t"
        );
      }
    }
  })
);


// -------------------------
// コマンド実行
// -------------------------

function runCommand(command, args) {

  return new Promise((resolve, reject) => {

    console.log(
      `[START] ${command} ${args.join(" ")}`
    );

    const process = spawn(
      command,
      args
    );

    let stdout = "";
    let stderr = "";

    process.stdout.on(
      "data",
      (data) => {
        stdout += data.toString();
      }
    );

    process.stderr.on(
      "data",
      (data) => {

        const text = data.toString();

        stderr += text;

        console.log(text);
      }
    );

    process.on(
      "error",
      (error) => {
        reject(error);
      }
    );

    process.on(
      "close",
      (code) => {

        console.log(
          `[END] ${command} exit=${code}`
        );

        if (code === 0) {

          resolve({
            stdout,
            stderr
          });

        } else {

          reject(
            new Error(
              `${command} failed\n${stderr}`
            )
          );

        }

      }
    );

  });

}


// -------------------------
// URLチェック
// -------------------------

function isValidYouTubeUrl(value) {

  try {

    const url = new URL(value);

    const hostname =
      url.hostname.toLowerCase();

    return (
      hostname === "youtube.com" ||
      hostname === "www.youtube.com" ||
      hostname === "m.youtube.com" ||
      hostname === "youtu.be" ||
      hostname === "www.youtu.be"
    );

  } catch {

    return false;

  }

}


// -------------------------
// YouTube → M3U8
// -------------------------

app.post(
  "/convert",
  async (req, res) => {

    const url = req.body?.url;

    console.log(
      "Received URL:",
      url
    );

    if (!url) {

      return res.status(400).json({
        error:
          "動画URLを入力してください。"
      });

    }


    if (!isValidYouTubeUrl(url)) {

      return res.status(400).json({
        error:
          "YouTube URLを入力してください。"
      });

    }


    const jobId =
      crypto.randomUUID();


    const workDir =
      path.join(
        DOWNLOAD_DIR,
        jobId
      );


    const outputDir =
      path.join(
        OUTPUT_DIR,
        jobId
      );


    fs.mkdirSync(
      workDir,
      {
        recursive: true
      }
    );


    fs.mkdirSync(
      outputDir,
      {
        recursive: true
      }
    );


    const inputFile =
      path.join(
        workDir,
        "input.mp4"
      );


    const playlistFile =
      path.join(
        outputDir,
        "playlist.m3u8"
      );


    try {

      console.log(
        "Starting yt-dlp..."
      );


      // --------------------------------
      // yt-dlp
      // --------------------------------

      await runCommand(
        "yt-dlp",
        [

          "--no-playlist",

          "-f",
          "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",

          "--merge-output-format",
          "mp4",

          "-o",
          inputFile,

          url

        ]
      );


      console.log(
        "yt-dlp finished."
      );


      // --------------------------------
      // ファイル確認
      // --------------------------------

      if (!fs.existsSync(inputFile)) {

        throw new Error(
          "yt-dlpは終了しましたが、動画ファイルが作成されませんでした。"
        );

      }


      const fileSize =
        fs.statSync(
          inputFile
        ).size;


      console.log(
        `Downloaded file size: ${fileSize} bytes`
      );


      if (fileSize === 0) {

        throw new Error(
          "動画ファイルのサイズが0です。"
        );

      }


      // --------------------------------
      // FFmpeg
      // --------------------------------

      console.log(
        "Starting FFmpeg..."
      );


      await runCommand(
        "ffmpeg",
        [

          "-y",

          "-i",
          inputFile,

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

          path.join(
            outputDir,
            "segment_%03d.ts"
          ),

          playlistFile

        ]
      );


      console.log(
        "FFmpeg finished."
      );


      // --------------------------------
      // M3U8確認
      // --------------------------------

      if (
        !fs.existsSync(
          playlistFile
        )
      ) {

        throw new Error(
          "M3U8ファイルが作成されませんでした。"
        );

      }


      // --------------------------------
      // 元動画削除
      // --------------------------------

      fs.rmSync(
        workDir,
        {
          recursive: true,
          force: true
        }
      );


      const playlistUrl =
        `/hls/${jobId}/playlist.m3u8`;


      console.log(
        "Conversion completed:",
        playlistUrl
      );


      res.json({

        success: true,

        playlist:
          playlistUrl,

        jobId:
          jobId

      });


    } catch (error) {

      console.error(
        "Conversion error:",
        error
      );


      try {

        fs.rmSync(
          workDir,
          {
            recursive: true,
            force: true
          }
        );

      } catch {}


      try {

        fs.rmSync(
          outputDir,
          {
            recursive: true,
            force: true
          }
        );

      } catch {}


      res.status(500).json({

        error:
          "動画の取得またはM3U8変換に失敗しました。",

        detail:
          error.message

      });

    }

  }
);


// -------------------------
// Health Check
// -------------------------

app.get(
  "/health",
  (req, res) => {

    res.json({
      status: "ok"
    });

  }
);


// -------------------------
// Server
// -------------------------

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `Server running on port ${PORT}`
    );

  }
);
