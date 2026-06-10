use serde_json::{json, Value};
use std::io::Write;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const HTTP_TIMEOUT_SECS: u64 = 90;
const CLI_TIMEOUT_SECS: u64 = 120;

#[derive(serde::Serialize)]
pub struct AiResult {
    pub success: bool,
    pub text: String,
    pub log: String,
    /// HTTP status when the failure came from the API (401/429/...), else None.
    pub status: Option<u16>,
}

#[derive(serde::Serialize)]
pub struct ClaudeCodeStatus {
    pub found: bool,
    pub version: Option<String>,
}

fn redact(s: &str, secret: &str) -> String {
    if secret.is_empty() {
        s.to_string()
    } else {
        s.replace(secret, "***")
    }
}

#[tauri::command]
pub async fn ai_complete(
    kind: String,
    base_url: String,
    api_key: String,
    model: String,
    system: String,
    prompt: String,
    max_tokens: u32,
) -> Result<AiResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("http client: {e}"))?;

    let base = base_url.trim_end_matches('/');
    // No sampling parameters in either body: recent Anthropic models reject
    // them outright, and defaults are fine everywhere else.
    let request = match kind.as_str() {
        "anthropic" => client
            .post(format!("{base}/v1/messages"))
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": model,
                "max_tokens": max_tokens,
                "system": system,
                "messages": [{"role": "user", "content": prompt}],
            })),
        _ => client
            .post(format!("{base}/chat/completions"))
            .header("authorization", format!("Bearer {api_key}"))
            .json(&json!({
                "model": model,
                "max_tokens": max_tokens,
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": prompt},
                ],
            })),
    };

    let resp = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            return Ok(AiResult {
                success: false,
                text: String::new(),
                log: redact(&format!("network error: {e}"), &api_key),
                status: None,
            });
        }
    };

    let status = resp.status().as_u16();
    let body = resp.text().await.unwrap_or_default();
    if !(200..300).contains(&status) {
        let snippet: String = body.chars().take(1500).collect();
        return Ok(AiResult {
            success: false,
            text: String::new(),
            log: redact(&format!("HTTP {status}: {snippet}"), &api_key),
            status: Some(status),
        });
    }

    let parsed: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(e) => {
            return Ok(AiResult {
                success: false,
                text: String::new(),
                log: redact(&format!("invalid JSON response: {e}"), &api_key),
                status: None,
            });
        }
    };

    let text = match kind.as_str() {
        "anthropic" => parsed["content"]
            .as_array()
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b["type"] == "text")
                    .filter_map(|b| b["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default(),
        _ => parsed["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or_default()
            .to_string(),
    };

    Ok(AiResult {
        success: !text.trim().is_empty(),
        text,
        log: if body.len() > 1500 {
            String::new()
        } else {
            redact(&body, &api_key)
        },
        status: None,
    })
}

// macOS GUI apps inherit a PATH without Homebrew; probe the usual spots.
fn find_claude_binary() -> Option<String> {
    let home = std::env::var("HOME").unwrap_or_default();
    let candidates = [
        "claude".to_string(),
        "/opt/homebrew/bin/claude".to_string(),
        "/usr/local/bin/claude".to_string(),
        format!("{home}/.local/bin/claude"),
    ];
    for c in candidates {
        if let Ok(out) = Command::new(&c).arg("--version").output() {
            if out.status.success() {
                return Some(c);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn claude_code_check() -> Result<ClaudeCodeStatus, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<ClaudeCodeStatus, String> {
        let Some(bin) = find_claude_binary() else {
            return Ok(ClaudeCodeStatus {
                found: false,
                version: None,
            });
        };
        let version = Command::new(&bin)
            .arg("--version")
            .output()
            .ok()
            .filter(|o| o.status.success())
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .filter(|s| !s.is_empty());
        Ok(ClaudeCodeStatus {
            found: true,
            version,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}

// PID of the in-flight CLI run, so cancel can kill it (one session at a time).
static RUNNING_CLI_PID: Mutex<Option<u32>> = Mutex::new(None);

#[tauri::command]
pub async fn claude_code_cancel() -> Result<(), String> {
    let pid = RUNNING_CLI_PID.lock().unwrap().take();
    if let Some(pid) = pid {
        let _ = Command::new("kill").arg(pid.to_string()).output();
    }
    Ok(())
}

#[tauri::command]
pub async fn claude_code_run(
    prompt: String,
    model: Option<String>,
) -> Result<AiResult, String> {
    tauri::async_runtime::spawn_blocking(move || -> Result<AiResult, String> {
        let Some(bin) = find_claude_binary() else {
            return Ok(AiResult {
                success: false,
                text: String::new(),
                log: "claude CLI not found".into(),
                status: None,
            });
        };

        let mut cmd = Command::new(&bin);
        cmd.args(["-p", "--output-format", "json"]);
        if let Some(m) = model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
            cmd.args(["--model", m]);
        }
        // Prompt goes through stdin: avoids argv length limits and injection.
        let mut child = cmd
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn claude failed: {e}"))?;

        *RUNNING_CLI_PID.lock().unwrap() = Some(child.id());

        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(prompt.as_bytes());
        } // drop closes stdin → CLI sees EOF

        let deadline = Instant::now() + Duration::from_secs(CLI_TIMEOUT_SECS);
        let timed_out = loop {
            match child.try_wait() {
                Ok(Some(_)) => break false,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        break true;
                    }
                    std::thread::sleep(Duration::from_millis(150));
                }
                Err(e) => return Err(format!("wait failed: {e}")),
            }
        };

        let out = child
            .wait_with_output()
            .map_err(|e| format!("collect output failed: {e}"))?;
        *RUNNING_CLI_PID.lock().unwrap() = None;

        if timed_out {
            return Ok(AiResult {
                success: false,
                text: String::new(),
                log: format!("claude CLI timed out after {CLI_TIMEOUT_SECS}s"),
                status: None,
            });
        }

        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        if !out.status.success() {
            return Ok(AiResult {
                success: false,
                text: String::new(),
                log: format!("claude exited {}: {}", out.status, stderr.chars().take(1500).collect::<String>()),
                status: None,
            });
        }

        let text = serde_json::from_str::<Value>(&stdout)
            .ok()
            .and_then(|v| v["result"].as_str().map(str::to_string))
            .unwrap_or_default();

        Ok(AiResult {
            success: !text.trim().is_empty(),
            text,
            log: String::new(),
            status: None,
        })
    })
    .await
    .map_err(|e| format!("join error: {e}"))?
}
