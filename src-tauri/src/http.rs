//! Minimal HTTP/HTTPS client used by the AI providers.

use crate::*;

pub struct HttpResponse {
    pub status_code: u16,
    pub body: String,
}

pub fn is_success_status(status_code: u16) -> bool {
    (200..300).contains(&status_code)
}

pub fn short_response_body(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        "empty response".to_string()
    } else {
        trimmed.chars().take(300).collect::<String>()
    }
}

pub fn build_http_request(
    method: &str,
    path: &str,
    host_header: &str,
    headers: &[(String, String)],
    body: Option<&str>,
) -> Vec<u8> {
    let body_len = body.map(|b| b.as_bytes().len()).unwrap_or(0);
    let mut request = format!(
        "{} {} HTTP/1.1\r\nHost: {}\r\nUser-Agent: differ/{}\r\nAccept: application/json\r\nConnection: close\r\n",
        method,
        path,
        host_header,
        env!("CARGO_PKG_VERSION")
    );

    for (name, value) in headers {
        let safe_name = name.replace(['\r', '\n'], "");
        let safe_value = value.replace(['\r', '\n'], "");
        request.push_str(&safe_name);
        request.push_str(": ");
        request.push_str(&safe_value);
        request.push_str("\r\n");
    }

    if body.is_some() {
        request.push_str(&format!("Content-Length: {}\r\n", body_len));
    }

    request.push_str("\r\n");
    let mut bytes = request.into_bytes();
    if let Some(body) = body {
        bytes.extend_from_slice(body.as_bytes());
    }
    bytes
}

pub fn find_crlf(bytes: &[u8], start: usize) -> Option<usize> {
    bytes
        .get(start..)?
        .windows(2)
        .position(|window| window == b"\r\n")
        .map(|pos| start + pos)
}

pub fn decode_chunked_body(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut pos = 0;
    let mut decoded = Vec::new();

    loop {
        let line_end = find_crlf(bytes, pos).ok_or("Invalid chunked response")?;
        let size_line = std::str::from_utf8(&bytes[pos..line_end])
            .map_err(|e| format!("Invalid chunk size: {}", e))?;
        let size_hex = size_line.split(';').next().unwrap_or("").trim();
        let size = usize::from_str_radix(size_hex, 16)
            .map_err(|e| format!("Invalid chunk size: {}", e))?;
        pos = line_end + 2;

        if size == 0 {
            break;
        }

        if pos + size > bytes.len() {
            return Err("Chunked response ended early".to_string());
        }

        decoded.extend_from_slice(&bytes[pos..pos + size]);
        pos += size;

        if bytes.get(pos..pos + 2) == Some(b"\r\n") {
            pos += 2;
        } else {
            return Err("Invalid chunk terminator".to_string());
        }
    }

    Ok(decoded)
}

pub fn parse_http_response(raw: &[u8]) -> Result<HttpResponse, String> {
    let header_end = raw
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .ok_or("Invalid HTTP response: missing headers")?;
    let header_bytes = &raw[..header_end];
    let body_bytes = &raw[header_end + 4..];
    let headers_text = std::str::from_utf8(header_bytes)
        .map_err(|e| format!("Invalid HTTP response headers: {}", e))?;

    let mut lines = headers_text.lines();
    let status_line = lines
        .next()
        .ok_or("Invalid HTTP response: missing status line")?;
    let status_code = status_line
        .split_whitespace()
        .nth(1)
        .ok_or("Invalid HTTP response: missing status code")?
        .parse::<u16>()
        .map_err(|e| format!("Invalid HTTP status code: {}", e))?;

    let mut chunked = false;
    let mut content_length = None;

    for line in lines {
        if let Some((name, value)) = line.split_once(':') {
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
                chunked = true;
            } else if name == "content-length" {
                content_length = value.parse::<usize>().ok();
            }
        }
    }

    let body = if chunked {
        decode_chunked_body(body_bytes)?
    } else if let Some(length) = content_length {
        body_bytes[..body_bytes.len().min(length)].to_vec()
    } else {
        body_bytes.to_vec()
    };

    let body = String::from_utf8(body).map_err(|e| format!("Invalid UTF-8 response: {}", e))?;
    Ok(HttpResponse { status_code, body })
}

pub fn send_plain_http_request(
    addr: &str,
    host_header: &str,
    method: &str,
    path: &str,
    headers: &[(String, String)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    let mut stream =
        TcpStream::connect(addr).map_err(|e| format!("Connection to {} failed: {}", addr, e))?;
    stream
        .set_read_timeout(Some(timeout))
        .map_err(|e| format!("Could not set read timeout: {}", e))?;
    stream
        .set_write_timeout(Some(timeout))
        .map_err(|e| format!("Could not set write timeout: {}", e))?;

    let request = build_http_request(method, path, host_header, headers, body);
    stream
        .write_all(&request)
        .map_err(|e| format!("HTTP write failed: {}", e))?;
    stream
        .flush()
        .map_err(|e| format!("HTTP flush failed: {}", e))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("HTTP read failed: {}", e))?;
    parse_http_response(&raw)
}

pub fn send_https_request(
    host: &str,
    method: &str,
    path: &str,
    headers: &[(String, String)],
    body: Option<&str>,
    timeout: Duration,
) -> Result<HttpResponse, String> {
    let tcp = TcpStream::connect((host, 443))
        .map_err(|e| format!("Connection to {} failed: {}", host, e))?;
    tcp.set_read_timeout(Some(timeout))
        .map_err(|e| format!("Could not set read timeout: {}", e))?;
    tcp.set_write_timeout(Some(timeout))
        .map_err(|e| format!("Could not set write timeout: {}", e))?;

    let connector =
        native_tls::TlsConnector::new().map_err(|e| format!("Could not initialize TLS: {}", e))?;
    let mut stream = connector
        .connect(host, tcp)
        .map_err(|e| format!("TLS connection to {} failed: {}", host, e))?;

    let request = build_http_request(method, path, host, headers, body);
    stream
        .write_all(&request)
        .map_err(|e| format!("HTTPS write failed: {}", e))?;
    stream
        .flush()
        .map_err(|e| format!("HTTPS flush failed: {}", e))?;

    let mut raw = Vec::new();
    stream
        .read_to_end(&mut raw)
        .map_err(|e| format!("HTTPS read failed: {}", e))?;
    parse_http_response(&raw)
}

pub fn google_api_key_header(api_key: &str) -> Result<(String, String), String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API key is empty".to_string());
    }
    Ok(("x-goog-api-key".to_string(), key.to_string()))
}
