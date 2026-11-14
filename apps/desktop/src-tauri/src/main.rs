// Multi-functional Creator — desktop shell.
//
// The window shows a bundled connect screen until a server is chosen, then loads that server's panel
// directly (same origin as in a browser, so sign-in cookies, live collaboration and the service worker
// work unchanged). The remote panel gets no IPC access: only the bundled connect screen may call the
// two commands below, and they check the caller's origin as well.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{fs, net::IpAddr, path::PathBuf};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::TrayIconBuilder,
    webview::DownloadEvent,
    AppHandle, Manager, Url, Webview, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_opener::OpenerExt;

const MAIN: &str = "main";
/// Lets the web app know it runs inside the desktop shell (see apps/web/src/lib/native.ts).
const INIT_SCRIPT: &str = concat!("window.__MFC_DESKTOP__ = { version: \"", env!("CARGO_PKG_VERSION"), "\" };");

fn config_file(app: &AppHandle) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("server.json"))
}

fn saved_server(app: &AppHandle) -> Option<Url> {
    let raw = fs::read_to_string(config_file(app)?).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    parse_server(v.get("url")?.as_str()?).ok()
}

fn is_private_host(url: &Url) -> bool {
    let Some(host) = url.host_str() else { return false };
    if host == "localhost" || host.ends_with(".local") || host.ends_with(".localhost") {
        return true;
    }
    match host.trim_matches(|c| c == '[' || c == ']').parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => ip.is_loopback() || ip.is_private() || ip.is_link_local(),
        Ok(IpAddr::V6(ip)) => ip.is_loopback(),
        Err(_) => false,
    }
}

/// Normalise what the user typed into a server origin. Plain http is only allowed on local networks.
fn parse_server(raw: &str) -> Result<Url, String> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Enter your panel's address".into());
    }
    let lower = trimmed.to_ascii_lowercase();
    let with_scheme = if lower.starts_with("http://") || lower.starts_with("https://") {
        trimmed.to_string()
    } else if trimmed.contains("://") {
        return Err("Only http(s) addresses are supported".into());
    } else {
        format!("https://{trimmed}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|e| format!("That isn't a valid address ({e})"))?;
    if url.host_str().is_none() {
        return Err("That isn't a valid address".into());
    }
    match url.scheme() {
        "https" => {}
        "http" if is_private_host(&url) => {}
        "http" => return Err("Use https:// — plain http is only allowed for localhost and your local network".into()),
        _ => return Err("Only http(s) addresses are supported".into()),
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

fn app_url(query: &str) -> Url {
    #[cfg(windows)]
    let base = "http://tauri.localhost/index.html";
    #[cfg(not(windows))]
    let base = "tauri://localhost/index.html";
    let mut u = Url::parse(base).expect("static url");
    if !query.is_empty() {
        u.set_query(Some(query));
    }
    u
}

fn is_app_url(u: &Url) -> bool {
    u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost")
}

fn same_origin(a: &Url, b: &Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// The saved server, for the connect screen.
#[tauri::command]
fn get_server(app: AppHandle) -> Option<String> {
    saved_server(&app).map(|u| u.to_string())
}

/// Save the server and open it in the main window.
#[tauri::command]
fn connect(app: AppHandle, webview: Webview, url: String) -> Result<String, String> {
    if !webview.url().map(|u| is_app_url(&u)).unwrap_or(false) {
        return Err("Not allowed".into());
    }
    let url = parse_server(&url)?;
    let file = config_file(&app).ok_or("No configuration folder")?;
    if let Some(dir) = file.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&file, serde_json::json!({ "url": url.as_str() }).to_string()).map_err(|e| e.to_string())?;
    if let Some(w) = app.get_webview_window(MAIN) {
        w.navigate(url.clone()).map_err(|e| e.to_string())?;
    }
    Ok(url.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window(MAIN) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

/// Save downloads straight to the Downloads folder without overwriting existing files.
fn download_path(app: &AppHandle, suggested: &PathBuf) -> PathBuf {
    let dir = app.path().download_dir().unwrap_or_else(|_| std::env::temp_dir());
    let name = suggested.file_name().map(|n| n.to_string_lossy().to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| "download".into());
    let mut candidate = dir.join(&name);
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) if !s.is_empty() => (s.to_string(), format!(".{e}")),
        _ => (name.clone(), String::new()),
    };
    let mut n = 1;
    while candidate.exists() {
        candidate = dir.join(format!("{stem} ({n}){ext}"));
        n += 1;
    }
    candidate
}

fn open_main_window(app: &AppHandle) -> tauri::Result<()> {
    let start = match saved_server(app) {
        Some(url) => WebviewUrl::External(url),
        None => WebviewUrl::App("index.html".into()),
    };
    let nav_app = app.clone();
    let dl_app = app.clone();
    WebviewWindowBuilder::new(app, MAIN, start)
        .title("Multi-functional Creator")
        .inner_size(1360.0, 860.0)
        .min_inner_size(380.0, 560.0)
        .initialization_script(INIT_SCRIPT)
        .on_navigation(move |url| {
            // The panel and the connect screen stay in the window; any other web page opens in the
            // system browser (docs, Stripe Checkout, deploy previews…).
            if is_app_url(url) || matches!(url.scheme(), "about" | "blob" | "data") {
                return true;
            }
            if let Some(server) = saved_server(&nav_app) {
                if same_origin(url, &server) {
                    return true;
                }
            }
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = nav_app.opener().open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .on_download(move |_webview, event| {
            if let DownloadEvent::Requested { destination, .. } = event {
                *destination = download_path(&dl_app, destination);
            }
            true
        })
        .build()?;
    Ok(())
}

fn build_menus(app: &AppHandle) -> tauri::Result<()> {
    let reload = MenuItem::with_id(app, "reload", "Reload", true, Some("CmdOrCtrl+R"))?;
    let change = MenuItem::with_id(app, "change-server", "Change server…", true, None::<&str>)?;
    let browser = MenuItem::with_id(app, "open-browser", "Open in browser", true, None::<&str>)?;
    let server = Submenu::with_items(app, "Server", true, &[&reload, &change, &PredefinedMenuItem::separator(app)?, &browser])?;
    let menu = Menu::default(app)?;
    menu.append(&server)?;
    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let Some(w) = app.get_webview_window(MAIN) else { return };
        match event.id().as_ref() {
            "reload" => {
                let _ = w.eval("location.reload()");
            }
            "change-server" => {
                let _ = w.navigate(app_url("change=1"));
            }
            "open-browser" => {
                if let Some(server) = saved_server(app) {
                    let target = w.url().ok().filter(|u| same_origin(u, &server)).unwrap_or(server);
                    let _ = app.opener().open_url(target.as_str(), None::<&str>);
                }
            }
            _ => {}
        }
    });

    let show = MenuItem::with_id(app, "tray-show", "Show Multi-functional Creator", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let tray_menu = Menu::with_items(app, &[&show, &PredefinedMenuItem::separator(app)?, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main").tooltip("Multi-functional Creator").menu(&tray_menu).on_menu_event(|app, event| match event.id().as_ref() {
        "tray-show" => show_main(app),
        "tray-quit" => app.exit(0),
        _ => {}
    });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        // Opening the app again focuses the existing window instead of starting a second copy.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_server, connect])
        .setup(|app| {
            let handle = app.handle().clone();
            build_menus(&handle)?;
            open_main_window(&handle)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Multi-functional Creator");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalises_server_addresses() {
        assert_eq!(parse_server("panel.example.com").unwrap().as_str(), "https://panel.example.com/");
        assert_eq!(parse_server(" https://x.vercel.app/settings?tab=1 ").unwrap().as_str(), "https://x.vercel.app/");
        assert_eq!(parse_server("http://localhost:8787").unwrap().as_str(), "http://localhost:8787/");
        assert_eq!(parse_server("http://192.168.1.20:8787").unwrap().as_str(), "http://192.168.1.20:8787/");
        assert!(parse_server("http://panel.example.com").is_err());
        assert!(parse_server("ftp://x").is_err());
        assert!(parse_server("").is_err());
    }

    #[test]
    fn recognises_origins() {
        let a = Url::parse("https://p.example.com/").unwrap();
        assert!(same_origin(&Url::parse("https://p.example.com/builder?x=1").unwrap(), &a));
        assert!(!same_origin(&Url::parse("https://checkout.stripe.com/c/1").unwrap(), &a));
        assert!(is_app_url(&app_url("change=1")));
    }
}
