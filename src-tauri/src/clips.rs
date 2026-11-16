//! Clipping: a rolling replay buffer of the screen (FFmpeg + Desktop Duplication, hardware encoder)
//! and system audio (WASAPI loopback via cpal). A hotkey saves the last N seconds as an MP4.
//!
//! FFmpeg isn't bundled (it's big); `install` downloads the official BtbN LGPL build once and checks
//! its SHA-256 against the release's checksums file.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, SystemTime};

const NO_WINDOW: u32 = 0x0800_0000;
const SEG: u32 = 2; // seconds per buffer segment
const FFMPEG_ZIP: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-lgpl-shared.zip";
const FFMPEG_SUMS: &str = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/checksums.sha256";
const ZIP_NAME: &str = "ffmpeg-master-latest-win64-lgpl-shared.zip";

#[derive(Clone, Debug)]
pub struct Config {
    pub seconds: u32,
    pub fps: u32,
    pub monitor: u32,
    pub height: u32, // 0 = native
    pub quality: String,
    pub audio: bool,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    pub running: bool,
    pub encoder: String,
    pub error: Option<String>,
    pub audio: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClipFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub modified: u64,
}

pub struct Clipper {
    root: PathBuf,
    buf: PathBuf,
    child: Mutex<Option<Child>>,
    job: Mutex<isize>,
    audio: Arc<Mutex<AudioRing>>,
    audio_stop: Mutex<Option<mpsc::Sender<()>>>,
    status: Mutex<Status>,
    encoder: Mutex<Option<String>>,
    config: Mutex<Option<Config>>,
    saving: Mutex<()>,
}

impl Clipper {
    pub fn new(app_dir: &Path) -> Self {
        let c = Clipper {
            root: app_dir.join("ffmpeg"),
            buf: app_dir.join("clipbuf"),
            child: Mutex::new(None),
            job: Mutex::new(0),
            audio: Arc::new(Mutex::new(AudioRing::default())),
            audio_stop: Mutex::new(None),
            status: Mutex::new(Status::default()),
            encoder: Mutex::new(None),
            config: Mutex::new(None),
            saving: Mutex::new(()),
        };
        c.status.lock().unwrap_or_else(|e| e.into_inner()).installed = c.ffmpeg().is_some();
        c
    }

    pub fn status(&self) -> Status {
        let mut s = self.status.lock().unwrap_or_else(|e| e.into_inner()).clone();
        s.installed = self.ffmpeg().is_some();
        if s.running {
            if let Some(ch) = self.child.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
                if let Ok(Some(code)) = ch.try_wait() {
                    s.running = false;
                    s.error = Some(self.ffmpeg_error().unwrap_or_else(|| format!("The recorder stopped (code {code})")));
                    *self.status.lock().unwrap_or_else(|e| e.into_inner()) = s.clone();
                }
            }
        }
        s
    }

    fn ffmpeg(&self) -> Option<PathBuf> {
        let p = self.root.join("ffmpeg.exe");
        p.exists().then_some(p)
    }
    fn ffprobe(&self) -> Option<PathBuf> {
        let p = self.root.join("ffprobe.exe");
        p.exists().then_some(p)
    }

    fn ffmpeg_error(&self) -> Option<String> {
        let log = std::fs::read_to_string(self.buf.join("ffmpeg.log")).ok()?;
        log.lines().filter(|l| !l.trim().is_empty()).last().map(|l| l.chars().take(200).collect())
    }

    // ------------------------------------------------------------ install

    /// Download FFmpeg (about 80 MB), verify it, and unpack ffmpeg.exe, ffprobe.exe and their DLLs.
    pub fn install(&self, progress: impl Fn(f64)) -> Result<(), String> {
        let sums = ureq::get(FFMPEG_SUMS).call().map_err(|e| format!("Couldn't reach GitHub: {e}"))?.into_string().map_err(|e| e.to_string())?;
        let want = sums
            .lines()
            .find(|l| l.trim_end().ends_with(ZIP_NAME))
            .and_then(|l| l.split_whitespace().next())
            .ok_or("Couldn't find the FFmpeg checksum")?
            .to_lowercase();
        let resp = ureq::get(FFMPEG_ZIP).call().map_err(|e| format!("Download failed: {e}"))?;
        let total: f64 = resp.header("Content-Length").and_then(|v| v.parse().ok()).unwrap_or(85_000_000.0);
        std::fs::create_dir_all(&self.root).map_err(|e| e.to_string())?;
        let zip_path = self.root.join("download.zip");
        let mut out = std::fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut reader = resp.into_reader();
        let mut chunk = vec![0u8; 1 << 16];
        let (mut got, mut last) = (0f64, 0f64);
        loop {
            let n = reader.read(&mut chunk).map_err(|e| format!("Download failed: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&chunk[..n]);
            out.write_all(&chunk[..n]).map_err(|e| e.to_string())?;
            got += n as f64;
            if got - last > 1_000_000.0 {
                last = got;
                progress((got / total).min(0.99));
            }
        }
        drop(out);
        let have: String = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect();
        if have != want {
            let _ = std::fs::remove_file(&zip_path);
            return Err("The FFmpeg download didn't match its checksum, so it wasn't installed. Try again.".into());
        }
        let f = std::fs::File::open(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(f).map_err(|e| e.to_string())?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().replace('\\', "/");
            if !name.contains("/bin/") || entry.is_dir() {
                continue;
            }
            let file = name.rsplit('/').next().unwrap_or_default().to_string();
            if file.is_empty() || file == "ffplay.exe" || file.contains("..") {
                continue;
            }
            let mut dst = std::fs::File::create(self.root.join(&file)).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut dst).map_err(|e| e.to_string())?;
        }
        let _ = std::fs::remove_file(&zip_path);
        progress(1.0);
        if self.ffmpeg().is_none() {
            return Err("FFmpeg didn't unpack correctly".into());
        }
        Ok(())
    }

    // ------------------------------------------------------------ recording

    fn video_filter(cfg: &Config) -> String {
        let scale = if cfg.height > 0 { format!("scale=-2:'min(ih,{})':flags=bicubic,", cfg.height) } else { String::new() };
        format!("hwdownload,format=bgra,{scale}format=nv12")
    }

    /// First hardware encoder that works on this PC (NVIDIA, AMD, Intel), else Windows' Media Foundation.
    fn pick_encoder(&self, ff: &Path, cfg: &Config) -> Result<String, String> {
        if let Some(e) = self.encoder.lock().unwrap_or_else(|e| e.into_inner()).clone() {
            return Ok(e);
        }
        let mut last_err = String::new();
        for enc in ["h264_nvenc", "h264_amf", "h264_qsv", "h264_mf"] {
            let out = Command::new(ff)
                .creation_flags(NO_WINDOW)
                .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
                .arg(format!("ddagrab=output_idx={}:framerate=10", cfg.monitor))
                .args(["-vf", &Self::video_filter(cfg), "-frames:v", "5", "-c:v", enc, "-f", "null", "-"])
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                *self.encoder.lock().unwrap_or_else(|e| e.into_inner()) = Some(enc.to_string());
                return Ok(enc.to_string());
            }
            last_err = String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or_default().to_string();
        }
        Err(format!("Couldn't start screen capture. {last_err}"))
    }

    fn rate_args(enc: &str, cfg: &Config) -> Vec<String> {
        let mbps = match (cfg.quality.as_str(), cfg.height) {
            ("high", h) if h == 0 || h > 1080 => 35,
            ("high", _) => 22,
            (_, h) if h == 0 || h > 1080 => 18,
            _ => 12,
        };
        let b = format!("{mbps}M");
        let max = format!("{}M", mbps * 3 / 2);
        let v: Vec<&str> = match enc {
            "h264_nvenc" => vec!["-preset", "p4", "-rc", "vbr", "-b:v", &b, "-maxrate", &max],
            "h264_amf" => vec!["-quality", "speed", "-rc", "vbr_peak", "-b:v", &b, "-maxrate", &max],
            "h264_qsv" => vec!["-preset", "faster", "-b:v", &b, "-maxrate", &max],
            _ => vec!["-rate_control", "cbr", "-b:v", &b],
        };
        v.into_iter().map(String::from).collect()
    }

    /// Start (or restart) the replay buffer with these settings.
    pub fn start(&self, cfg: Config) -> Result<(), String> {
        self.stop();
        let ff = self.ffmpeg().ok_or("Set up clipping first")?;
        let _ = std::fs::remove_dir_all(&self.buf);
        std::fs::create_dir_all(&self.buf).map_err(|e| e.to_string())?;
        let enc = match self.pick_encoder(&ff, &cfg) {
            Ok(e) => e,
            Err(e) => {
                *self.status.lock().unwrap_or_else(|e| e.into_inner()) = Status { installed: true, running: false, encoder: String::new(), error: Some(e.clone()), audio: false };
                return Err(e);
            }
        };
        let wrap = cfg.seconds / SEG + 3;
        let log = std::fs::File::create(self.buf.join("ffmpeg.log")).map_err(|e| e.to_string())?;
        let mut cmd = Command::new(&ff);
        cmd.creation_flags(NO_WINDOW)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::from(log))
            .args(["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i"])
            .arg(format!("ddagrab=output_idx={}:framerate={}:draw_mouse=1", cfg.monitor, cfg.fps))
            .args(["-vf", &Self::video_filter(&cfg), "-c:v", &enc])
            .args(Self::rate_args(&enc, &cfg))
            .args(["-g", &(cfg.fps * SEG).to_string()])
            .args(["-f", "segment", "-segment_time", &SEG.to_string(), "-segment_wrap", &wrap.to_string(), "-reset_timestamps", "1", "-segment_format", "mpegts"])
            .arg(self.buf.join("seg%03d.ts"));
        let child = cmd.spawn().map_err(|e| format!("Couldn't start FFmpeg: {e}"))?;
        self.kill_with_us(&child);
        *self.child.lock().unwrap_or_else(|e| e.into_inner()) = Some(child);

        let audio_ok = cfg.audio && self.start_audio(cfg.seconds + 10).is_ok();
        *self.config.lock().unwrap_or_else(|e| e.into_inner()) = Some(cfg);
        *self.status.lock().unwrap_or_else(|e| e.into_inner()) = Status { installed: true, running: true, encoder: enc, error: None, audio: audio_ok };
        Ok(())
    }

    /// Put FFmpeg in a job object that dies with Squadr, so it never keeps recording after a crash.
    fn kill_with_us(&self, child: &Child) {
        use std::os::windows::io::AsRawHandle;
        use windows_sys::Win32::System::JobObjects::*;
        unsafe {
            let mut job = *self.job.lock().unwrap_or_else(|e| e.into_inner());
            if job == 0 {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return;
                }
                let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                SetInformationJobObject(h, JobObjectExtendedLimitInformation, &info as *const _ as *const _, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32);
                job = h as isize;
                *self.job.lock().unwrap_or_else(|e| e.into_inner()) = job;
            }
            AssignProcessToJobObject(job as _, child.as_raw_handle() as _);
        }
    }

    pub fn stop(&self) {
        if let Some(mut ch) = self.child.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = ch.kill();
            let _ = ch.wait();
        }
        if let Some(tx) = self.audio_stop.lock().unwrap_or_else(|e| e.into_inner()).take() {
            let _ = tx.send(());
        }
        let mut s = self.status.lock().unwrap_or_else(|e| e.into_inner());
        s.running = false;
        s.audio = false;
    }

    pub fn is_running(&self) -> bool {
        self.status().running
    }

    // ------------------------------------------------------------ audio

    fn start_audio(&self, keep_secs: u32) -> Result<(), String> {
        let (tx, rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let ring = self.audio.clone();
        std::thread::spawn(move || {
            use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
            let host = cpal::default_host();
            let Some(dev) = host.default_output_device() else {
                let _ = ready_tx.send(Err("No audio output device".into()));
                return;
            };
            let Ok(cfg) = dev.default_output_config() else {
                let _ = ready_tx.send(Err("No audio format".into()));
                return;
            };
            {
                let mut r = ring.lock().unwrap_or_else(|e| e.into_inner());
                *r = AudioRing { rate: cfg.sample_rate().0, ch: cfg.channels(), keep: keep_secs, ..Default::default() };
            }
            let r2 = ring.clone();
            let err = |e| eprintln!("audio: {e}");
            // Opening an input stream on an output device gives WASAPI loopback: what you hear.
            let stream = match cfg.sample_format() {
                cpal::SampleFormat::F32 => dev.build_input_stream(&cfg.clone().into(), move |d: &[f32], _: &_| r2.lock().unwrap_or_else(|e| e.into_inner()).push(d.iter().copied()), err, None),
                cpal::SampleFormat::I16 => dev.build_input_stream(&cfg.clone().into(), move |d: &[i16], _: &_| r2.lock().unwrap_or_else(|e| e.into_inner()).push(d.iter().map(|s| *s as f32 / 32768.0)), err, None),
                f => {
                    let _ = ready_tx.send(Err(format!("Unsupported audio format {f:?}")));
                    return;
                }
            };
            let stream = match stream {
                Ok(s) => s,
                Err(e) => {
                    let _ = ready_tx.send(Err(e.to_string()));
                    return;
                }
            };
            if let Err(e) = stream.play() {
                let _ = ready_tx.send(Err(e.to_string()));
                return;
            }
            let _ = ready_tx.send(Ok(()));
            let _ = rx.recv(); // keep the stream alive until stop()
            drop(stream);
        });
        let res = ready_rx.recv_timeout(Duration::from_secs(5)).unwrap_or(Err("Audio didn't start".into()));
        if res.is_ok() {
            *self.audio_stop.lock().unwrap_or_else(|e| e.into_inner()) = Some(tx);
        }
        res
    }

    // ------------------------------------------------------------ saving

    /// Save the last `seconds` of the buffer into `dir`. Returns the new file.
    pub fn save(&self, dir: &Path) -> Result<PathBuf, String> {
        let _guard = self.saving.lock().unwrap_or_else(|e| e.into_inner());
        if !self.is_running() {
            return Err("Clipping is off".into());
        }
        let cfg = self.config.lock().unwrap_or_else(|e| e.into_inner()).clone().ok_or("Clipping is off")?;
        let ff = self.ffmpeg().ok_or("FFmpeg is missing")?;
        let now = SystemTime::now();
        // finish the segment being written so the clip includes the last moment
        std::thread::sleep(Duration::from_millis(300));
        let mut segs: Vec<(PathBuf, SystemTime)> = std::fs::read_dir(&self.buf)
            .map_err(|e| e.to_string())?
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().ends_with(".ts"))
            .filter_map(|e| Some((e.path(), e.metadata().ok()?.modified().ok()?)))
            .collect();
        segs.sort_by_key(|(_, m)| *m);
        let since = now - Duration::from_secs(cfg.seconds as u64);
        let pick: Vec<_> = segs.iter().filter(|(_, m)| *m >= since).collect();
        if pick.is_empty() {
            return Err("Nothing recorded yet. Give it a few seconds.".into());
        }
        let end_time = pick.last().unwrap().1;

        let work = self.buf.join("save");
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).map_err(|e| e.to_string())?;
        let list = work.join("list.txt");
        let body: String = pick.iter().map(|(p, _)| format!("file '{}'\n", p.to_string_lossy().replace('\\', "/").replace('\'', "'\\''"))).collect();
        std::fs::write(&list, body).map_err(|e| e.to_string())?;
        let video = work.join("video.mp4");
        run(Command::new(&ff).args(["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i"]).arg(&list).args(["-c", "copy"]).arg(&video))?;

        std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't create the clips folder: {e}"))?;
        let out = unique(dir.join(format!("Squadr clip {}.mp4", local_stamp())));
        let dur = self.ffprobe().and_then(|p| probe_duration(&p, &video));
        let wav = work.join("audio.wav");
        let with_audio = self.status.lock().unwrap_or_else(|e| e.into_inner()).audio && dur.is_some() && self.audio.lock().unwrap_or_else(|e| e.into_inner()).write_wav(&wav, dur.unwrap(), end_time).is_ok();
        let mut cmd = Command::new(&ff);
        cmd.args(["-hide_banner", "-loglevel", "error", "-y", "-i"]).arg(&video);
        if with_audio {
            cmd.arg("-i").arg(&wav).args(["-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest"]);
        } else {
            cmd.args(["-c", "copy"]);
        }
        cmd.args(["-movflags", "+faststart"]).arg(&out);
        run(&mut cmd)?;
        let _ = std::fs::remove_dir_all(&work);
        Ok(out)
    }
}

fn run(cmd: &mut Command) -> Result<(), String> {
    let out = cmd.creation_flags(NO_WINDOW).output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!("Saving the clip failed. {}", String::from_utf8_lossy(&out.stderr).lines().last().unwrap_or_default()))
    }
}

fn probe_duration(ffprobe: &Path, file: &Path) -> Option<f64> {
    let out = Command::new(ffprobe)
        .creation_flags(NO_WINDOW)
        .args(["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0"])
        .arg(file)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).trim().parse().ok()
}

fn unique(p: PathBuf) -> PathBuf {
    if !p.exists() {
        return p;
    }
    let stem = p.file_stem().unwrap_or_default().to_string_lossy().to_string();
    for i in 2..1000 {
        let q = p.with_file_name(format!("{stem} ({i}).mp4"));
        if !q.exists() {
            return q;
        }
    }
    p
}

/// "2026-11-14 22-50-01" in local time.
fn local_stamp() -> String {
    use windows_sys::Win32::System::SystemInformation::GetLocalTime;
    let t = unsafe {
        let mut t = std::mem::zeroed();
        GetLocalTime(&mut t);
        t
    };
    format!("{:04}-{:02}-{:02} {:02}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
}

/// Clips in a folder, newest first.
pub fn list(dir: &Path) -> Vec<ClipFile> {
    let mut v: Vec<ClipFile> = std::fs::read_dir(dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().extension().map(|x| x.eq_ignore_ascii_case("mp4")).unwrap_or(false))
                .filter_map(|e| {
                    let m = e.metadata().ok()?;
                    Some(ClipFile {
                        name: e.file_name().to_string_lossy().to_string(),
                        path: e.path().to_string_lossy().to_string(),
                        size: m.len(),
                        modified: m.modified().ok()?.duration_since(SystemTime::UNIX_EPOCH).ok()?.as_millis() as u64,
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    v.sort_by(|a, b| b.modified.cmp(&a.modified));
    v
}

// ---------------------------------------------------------------- audio ring

/// The last few seconds of system audio. WASAPI loopback sends nothing while nothing is playing,
/// so gaps are filled with silence to keep audio in step with the video.
#[derive(Default)]
struct AudioRing {
    buf: VecDeque<f32>,
    rate: u32,
    ch: u16,
    keep: u32,
    last: Option<SystemTime>,
}

impl AudioRing {
    fn push(&mut self, data: impl ExactSizeIterator<Item = f32>) {
        let now = SystemTime::now();
        let n = data.len();
        if let (Some(last), true) = (self.last, self.rate > 0) {
            let chunk = n as f64 / (self.rate as f64 * self.ch as f64);
            let gap = now.duration_since(last).unwrap_or_default().as_secs_f64() - chunk;
            if gap > 0.05 {
                let zeros = (gap * self.rate as f64) as usize * self.ch as usize;
                self.buf.extend(std::iter::repeat(0.0).take(zeros.min(self.cap())));
            }
        }
        self.buf.extend(data);
        self.last = Some(now);
        let cap = self.cap();
        while self.buf.len() > cap {
            self.buf.pop_front();
        }
    }

    fn cap(&self) -> usize {
        self.rate as usize * self.ch as usize * self.keep.max(5) as usize
    }

    /// `secs` of audio ending at `end` (the time of the last video frame), as 16-bit WAV.
    fn write_wav(&self, path: &Path, secs: f64, end: SystemTime) -> Result<(), String> {
        if self.rate == 0 || self.ch == 0 {
            return Err("no audio".into());
        }
        let ch = self.ch as usize;
        let per_sec = self.rate as f64 * ch as f64;
        // silence between the last audio packet and the end of the video
        let tail_gap = match self.last {
            Some(l) => end.duration_since(l).map(|d| d.as_secs_f64()).unwrap_or(0.0),
            None => secs,
        };
        let pad_end = ((tail_gap.max(0.0) * per_sec) as usize / ch) * ch;
        let want = ((secs * per_sec) as usize / ch) * ch;
        let mut samples: Vec<f32> = self.buf.iter().copied().chain(std::iter::repeat(0.0).take(pad_end)).collect();
        if samples.len() > want {
            samples.drain(..samples.len() - want);
        } else {
            let mut front = vec![0.0; want - samples.len()];
            front.extend(samples);
            samples = front;
        }
        let data_len = (samples.len() * 2) as u32;
        let mut f = std::fs::File::create(path).map_err(|e| e.to_string())?;
        let mut h = Vec::with_capacity(44 + samples.len() * 2);
        h.extend_from_slice(b"RIFF");
        h.extend_from_slice(&(36 + data_len).to_le_bytes());
        h.extend_from_slice(b"WAVEfmt ");
        h.extend_from_slice(&16u32.to_le_bytes());
        h.extend_from_slice(&1u16.to_le_bytes());
        h.extend_from_slice(&(ch as u16).to_le_bytes());
        h.extend_from_slice(&self.rate.to_le_bytes());
        h.extend_from_slice(&(self.rate * ch as u32 * 2).to_le_bytes());
        h.extend_from_slice(&((ch * 2) as u16).to_le_bytes());
        h.extend_from_slice(&16u16.to_le_bytes());
        h.extend_from_slice(b"data");
        h.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            h.extend_from_slice(&((s.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
        }
        f.write_all(&h).map_err(|e| e.to_string())
    }
}

pub type Shared = Arc<Clipper>;
