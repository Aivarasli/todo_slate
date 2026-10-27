//! Folder storage for tasks and pictures. Std only, so it can be tested on its own:
//! `rustc --edition 2021 --test src/sync.rs -o /tmp/sync_tests && /tmp/sync_tests`.
//!
//! Layout inside the chosen folder:
//!   slate-tasks.json          the task list (written atomically)
//!   pictures/<id>.jpg         one resized picture per task
//! Every function takes the folder as a string from the page, so each one checks it
//! and only ever touches those fixed names.
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

pub const TASKS_FILE: &str = "slate-tasks.json";
const PICTURES_DIR: &str = "pictures";
const MAX_TASKS_BYTES: u64 = 20 * 1024 * 1024;
const MAX_PICTURE_BYTES: usize = 12 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct Stat {
    pub exists: bool,
    pub mtime_ms: u64,
    pub len: u64,
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The folder must be an absolute path to an existing directory.
pub fn check_dir(dir: &str) -> Result<PathBuf, String> {
    if dir.is_empty() || dir.len() > 4096 || dir.contains('\0') {
        return Err("invalid folder".into());
    }
    let p = PathBuf::from(dir);
    if !p.is_absolute() {
        return Err("invalid folder".into());
    }
    match fs::metadata(&p) {
        Ok(m) if m.is_dir() => Ok(p),
        Ok(_) => Err("not a folder".into()),
        Err(_) => Err("folder not found".into()),
    }
}

/// Picture ids are made of letters, digits, dash and underscore only.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// Files other apps may leave next to the list, for example Dropbox's "conflicted copy".
/// Accepts `slate-tasks<anything without slashes>.json`, never the main file.
pub fn valid_extra_name(name: &str) -> bool {
    name != TASKS_FILE
        && name.starts_with("slate-tasks")
        && name.ends_with(".json")
        && name.len() <= 200
        && !name.contains('/')
        && !name.contains('\\')
        && !name.contains('\0')
        && !name.contains("..")
}

fn stat_of(path: &Path) -> Stat {
    match fs::metadata(path) {
        Ok(m) if m.is_file() => Stat { exists: true, mtime_ms: mtime_ms(&m), len: m.len() },
        _ => Stat { exists: false, mtime_ms: 0, len: 0 },
    }
}

pub fn tasks_stat(dir: &str) -> Result<Stat, String> {
    let d = check_dir(dir)?;
    Ok(stat_of(&d.join(TASKS_FILE)))
}

fn read_text(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Ok(m) if m.is_file() => {
            if m.len() > MAX_TASKS_BYTES {
                return Err("file too large".into());
            }
            fs::read_to_string(path).map(Some).map_err(|e| e.to_string())
        }
        _ => Ok(None),
    }
}

pub fn read_tasks(dir: &str) -> Result<Option<String>, String> {
    let d = check_dir(dir)?;
    read_text(&d.join(TASKS_FILE))
}

pub fn read_extra(dir: &str, name: &str) -> Result<Option<String>, String> {
    let d = check_dir(dir)?;
    if !valid_extra_name(name) {
        return Err("invalid name".into());
    }
    read_text(&d.join(name))
}

pub fn list_extras(dir: &str) -> Result<Vec<String>, String> {
    let d = check_dir(dir)?;
    let mut out = Vec::new();
    for e in fs::read_dir(&d).map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        if let Some(name) = e.file_name().to_str() {
            if valid_extra_name(name) && e.metadata().map(|m| m.is_file()).unwrap_or(false) {
                out.push(name.to_string());
            }
        }
    }
    out.sort();
    Ok(out)
}

pub fn remove_extra(dir: &str, name: &str) -> Result<(), String> {
    let d = check_dir(dir)?;
    if !valid_extra_name(name) {
        return Err("invalid name".into());
    }
    match fs::remove_file(d.join(name)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Writes to a temporary file in the same folder, flushes it, then renames it over the real one,
/// so a reader (or Dropbox) never sees half a file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("invalid path")?;
    let name = path.file_name().and_then(|n| n.to_str()).ok_or("invalid path")?;
    let tmp = dir.join(format!(".{}.tmp-{}", name, std::process::id()));
    let res = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res.map_err(|e| e.to_string())
}

pub fn write_tasks(dir: &str, text: &str) -> Result<Stat, String> {
    let d = check_dir(dir)?;
    if text.len() as u64 > MAX_TASKS_BYTES {
        return Err("file too large".into());
    }
    let path = d.join(TASKS_FILE);
    write_atomic(&path, text.as_bytes())?;
    Ok(stat_of(&path))
}

fn pictures_dir(dir: &str, create: bool) -> Result<PathBuf, String> {
    let d = check_dir(dir)?.join(PICTURES_DIR);
    if create {
        fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    }
    Ok(d)
}

fn picture_path(dir: &str, id: &str, create: bool) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("invalid id".into());
    }
    Ok(pictures_dir(dir, create)?.join(format!("{id}.jpg")))
}

pub fn write_picture(dir: &str, id: &str, b64: &str) -> Result<(), String> {
    let bytes = base64_decode(b64).ok_or("invalid data")?;
    if bytes.is_empty() || bytes.len() > MAX_PICTURE_BYTES {
        return Err("invalid size".into());
    }
    write_atomic(&picture_path(dir, id, true)?, &bytes)
}

pub fn read_picture(dir: &str, id: &str) -> Result<Option<String>, String> {
    let p = picture_path(dir, id, false)?;
    match fs::read(&p) {
        Ok(b) if b.len() <= MAX_PICTURE_BYTES => Ok(Some(base64_encode(&b))),
        Ok(_) => Err("file too large".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// (id, modified time in ms) for every picture file.
pub fn list_pictures(dir: &str) -> Result<Vec<(String, u64)>, String> {
    let p = pictures_dir(dir, false)?;
    let mut out = Vec::new();
    let rd = match fs::read_dir(&p) {
        Ok(rd) => rd,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(e.to_string()),
    };
    for e in rd.flatten() {
        let name = e.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(id) = name.strip_suffix(".jpg") else { continue };
        if valid_id(id) {
            if let Ok(m) = e.metadata() {
                if m.is_file() {
                    out.push((id.to_string(), mtime_ms(&m)));
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

pub fn remove_picture(dir: &str, id: &str) -> Result<(), String> {
    let p = picture_path(dir, id, false)?;
    match fs::remove_file(p) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

// ---------- base64 (standard alphabet, with padding) ----------
const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { ALPHABET[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { ALPHABET[n as usize & 63] as char } else { '=' });
    }
    out
}

pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let bytes: Vec<u8> = s.bytes().filter(|b| !b.is_ascii_whitespace()).collect();
    if bytes.len() % 4 != 0 {
        return None;
    }
    let val = |c: u8| -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some(u32::from(c - b'A')),
            b'a'..=b'z' => Some(u32::from(c - b'a') + 26),
            b'0'..=b'9' => Some(u32::from(c - b'0') + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let last = bytes.len() / 4;
    for (i, q) in bytes.chunks(4).enumerate() {
        let pad = q.iter().rev().take_while(|&&c| c == b'=').count();
        if pad > 2 || (pad > 0 && i + 1 != last) {
            return None;
        }
        let mut n = 0u32;
        for (j, &c) in q.iter().enumerate() {
            let v = if j >= 4 - pad { if c == b'=' { 0 } else { return None } } else { val(c)? };
            n = (n << 6) | v;
        }
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("slate-sync-{}-{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn base64_round_trips() {
        for n in 0..40usize {
            let data: Vec<u8> = (0..n).map(|i| (i * 37 + 11) as u8).collect();
            assert_eq!(base64_decode(&base64_encode(&data)).unwrap(), data, "len {n}");
        }
        assert_eq!(base64_encode(b"Man"), "TWFu");
        assert_eq!(base64_encode(b"Ma"), "TWE=");
        assert_eq!(base64_encode(b"M"), "TQ==");
        assert_eq!(base64_decode("TWE=").unwrap(), b"Ma");
    }

    #[test]
    fn base64_rejects_bad_input() {
        assert!(base64_decode("abc").is_none());
        assert!(base64_decode("ab!d").is_none());
        assert!(base64_decode("=AAA").is_none());
        assert!(base64_decode("AA==AAAA").is_none());
        assert!(base64_decode("A===").is_none());
    }

    #[test]
    fn ids_and_names_are_checked() {
        assert!(valid_id("3f2a9c-1B_x"));
        for bad in ["", "../x", "a/b", "a b", "a.jpg", "é", &"x".repeat(81)] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(valid_extra_name("slate-tasks (Aivaras's conflicted copy 2026-10-27).json"));
        assert!(!valid_extra_name("slate-tasks.json"));
        assert!(!valid_extra_name("../slate-tasks.json"));
        assert!(!valid_extra_name("slate-tasks/../x.json"));
        assert!(!valid_extra_name("other.json"));
        assert!(!valid_extra_name("slate-tasks.txt"));
    }

    #[test]
    fn folder_must_exist_and_be_absolute() {
        assert!(check_dir("").is_err());
        assert!(check_dir("relative/path").is_err());
        assert!(check_dir("/definitely/not/here-123").is_err());
        let d = tmp("dir");
        assert!(check_dir(d.to_str().unwrap()).is_ok());
        let f = d.join("file");
        fs::write(&f, "x").unwrap();
        assert!(check_dir(f.to_str().unwrap()).is_err());
    }

    #[test]
    fn tasks_write_read_and_stat() {
        let d = tmp("tasks");
        let dir = d.to_str().unwrap();
        assert_eq!(read_tasks(dir).unwrap(), None);
        assert!(!tasks_stat(dir).unwrap().exists);
        let st = write_tasks(dir, "{\"a\":1}").unwrap();
        assert!(st.exists && st.len == 7);
        assert_eq!(read_tasks(dir).unwrap().as_deref(), Some("{\"a\":1}"));
        write_tasks(dir, "{\"a\":22}").unwrap();
        assert_eq!(read_tasks(dir).unwrap().as_deref(), Some("{\"a\":22}"));
        // no temporary file is left behind
        let names: Vec<_> = fs::read_dir(&d).unwrap().flatten().map(|e| e.file_name().into_string().unwrap()).collect();
        assert_eq!(names, vec![TASKS_FILE.to_string()]);
    }

    #[test]
    fn conflicted_copies_are_listed_read_and_removed() {
        let d = tmp("extras");
        let dir = d.to_str().unwrap();
        write_tasks(dir, "{}").unwrap();
        fs::write(d.join("slate-tasks (conflicted copy).json"), "{\"b\":2}").unwrap();
        fs::write(d.join("notes.json"), "x").unwrap();
        assert_eq!(list_extras(dir).unwrap(), vec!["slate-tasks (conflicted copy).json".to_string()]);
        assert_eq!(read_extra(dir, "slate-tasks (conflicted copy).json").unwrap().as_deref(), Some("{\"b\":2}"));
        assert!(read_extra(dir, "../etc/passwd").is_err());
        assert!(remove_extra(dir, TASKS_FILE).is_err());
        remove_extra(dir, "slate-tasks (conflicted copy).json").unwrap();
        remove_extra(dir, "slate-tasks (conflicted copy).json").unwrap(); // already gone is fine
        assert!(list_extras(dir).unwrap().is_empty());
        assert!(d.join("notes.json").exists());
    }

    #[test]
    fn pictures_round_trip_list_and_remove() {
        let d = tmp("pics");
        let dir = d.to_str().unwrap();
        assert!(list_pictures(dir).unwrap().is_empty());
        assert_eq!(read_picture(dir, "p1").unwrap(), None);
        let data = base64_encode(&[0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
        write_picture(dir, "p1", &data).unwrap();
        assert_eq!(read_picture(dir, "p1").unwrap().as_deref(), Some(data.as_str()));
        let l = list_pictures(dir).unwrap();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].0, "p1");
        assert!(write_picture(dir, "../p2", &data).is_err());
        assert!(write_picture(dir, "p3", "not base64!").is_err());
        assert!(write_picture(dir, "p3", "").is_err());
        remove_picture(dir, "p1").unwrap();
        remove_picture(dir, "p1").unwrap();
        assert!(list_pictures(dir).unwrap().is_empty());
    }
}
