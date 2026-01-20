use pyo3::prelude::*;
use pyo3::types::PyBytes;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tokio::sync::Mutex;
use tracing::{error, info, warn};

/// Global depth model state
pub struct DepthModel {
    estimator: PyObject,
}

// Safety: PyObject is Send when Python GIL is not held
unsafe impl Send for DepthModel {}
unsafe impl Sync for DepthModel {}

/// Find the python directory relative to the executable or current dir
fn find_python_dir() -> PathBuf {
    // Try relative to executable first
    if let Ok(exe) = std::env::current_exe() {
        let exe_dir = exe.parent().unwrap_or(&exe);
        let python_dir = exe_dir.join("python");
        if python_dir.exists() {
            return python_dir;
        }
        // Try one level up (for cargo run scenarios)
        if let Some(parent) = exe_dir.parent() {
            let python_dir = parent.join("python");
            if python_dir.exists() {
                return python_dir;
            }
        }
    }
    // Fall back to current directory
    PathBuf::from("./python")
}

/// Setup Python sys.path from PYTHONPATH environment variable
fn setup_python_path() {
    Python::with_gil(|py| {
        if let Ok(pythonpath) = std::env::var("PYTHONPATH") {
            let sys = py.import("sys").expect("Failed to import sys");
            let path = sys.getattr("path").expect("Failed to get sys.path");

            // Add each path from PYTHONPATH
            for p in pythonpath.split(if cfg!(windows) { ';' } else { ':' }) {
                if !p.is_empty() {
                    let _ = path.call_method1("insert", (0, p));
                }
            }
            info!("[DEPTH] Added PYTHONPATH entries to sys.path");
        }
    });
}

/// Check if required Python packages are installed
fn check_python_deps() -> bool {
    // First ensure PYTHONPATH is applied
    setup_python_path();

    Python::with_gil(|py| {
        // Try importing torch - if it fails, deps aren't installed
        py.import("torch").is_ok()
    })
}

/// Install Python dependencies using pip
fn install_python_deps(python_dir: &Path) -> anyhow::Result<()> {
    let requirements = python_dir.join("requirements.txt");

    if !requirements.exists() {
        return Err(anyhow::anyhow!(
            "requirements.txt not found at {:?}",
            requirements
        ));
    }

    info!(
        "[DEPTH] Installing Python dependencies from {:?}",
        requirements
    );

    // Try pip install with --user flag for non-venv scenarios
    let pip_cmds = [
        ("pip", vec!["install", "-r"]),
        ("pip3", vec!["install", "-r"]),
        ("python", vec!["-m", "pip", "install", "-r"]),
        ("python3", vec!["-m", "pip", "install", "-r"]),
    ];

    let req_str = requirements.to_string_lossy();
    let mut last_error = None;

    for (cmd, args) in &pip_cmds {
        let mut full_args = args.clone();
        full_args.push(&req_str);

        info!("[DEPTH] Trying: {} {}", cmd, full_args.join(" "));

        let result = Command::new(cmd).args(&full_args).output();

        match result {
            Ok(output) => {
                if output.status.success() {
                    info!("[DEPTH] Dependencies installed successfully");
                    return Ok(());
                }
                let stderr = String::from_utf8_lossy(&output.stderr);
                warn!("[DEPTH] {} failed: {}", cmd, stderr);
                last_error = Some(stderr.to_string());
            }
            Err(e) => {
                warn!("[DEPTH] {} not found: {}", cmd, e);
                last_error = Some(e.to_string());
            }
        }
    }

    Err(anyhow::anyhow!(
        "Failed to install dependencies. Last error: {}",
        last_error.unwrap_or_else(|| "unknown".into())
    ))
}

/// Setup Python environment and install deps if needed
fn setup_python_env() -> anyhow::Result<PathBuf> {
    let python_dir = find_python_dir();

    info!("[DEPTH] Python directory: {:?}", python_dir);

    if !python_dir.exists() {
        return Err(anyhow::anyhow!(
            "Python directory not found at {:?}. Make sure to run from project root or include python/ in distribution.",
            python_dir
        ));
    }

    // Add python dir to PYTHONPATH for module imports
    add_python_path(&python_dir);

    // Skip auto-install if DEPTH_SKIP_AUTO_INSTALL is set (e.g., when using venv)
    if std::env::var("DEPTH_SKIP_AUTO_INSTALL").is_ok() {
        info!("[DEPTH] Skipping auto-install (DEPTH_SKIP_AUTO_INSTALL set)");
        return Ok(python_dir);
    }

    // Check if deps are installed
    if !check_python_deps() {
        warn!("[DEPTH] Python dependencies not found, attempting to install...");

        match install_python_deps(&python_dir) {
            Ok(()) => {
                // Verify installation worked
                if !check_python_deps() {
                    return Err(anyhow::anyhow!(
                        "Dependencies installed but torch still not importable. \
                         You may need to restart the server."
                    ));
                }
            }
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "Failed to install Python dependencies: {}\n\
                     Please install manually:\n\
                     pip install -r {:?}",
                    e,
                    python_dir.join("requirements.txt")
                ));
            }
        }
    }

    Ok(python_dir)
}

/// Add python directory and any PYTHONPATH entries to sys.path
fn add_python_path(python_dir: &PathBuf) {
    Python::with_gil(|py| {
        if let Ok(sys) = py.import("sys")
            && let Ok(path) = sys.getattr("path")
        {
            // Add the python directory
            let dir_str = python_dir.to_string_lossy();
            let _ = path.call_method1("insert", (0, dir_str.as_ref()));
            info!("[DEPTH] Added {:?} to sys.path", python_dir);

            // Add PYTHONPATH entries if set (for venv support)
            // On Windows use ';' separator, on Unix use ':'
            if let Ok(pythonpath) = std::env::var("PYTHONPATH") {
                #[cfg(windows)]
                let separator = ';';
                #[cfg(not(windows))]
                let separator = ':';

                for entry in pythonpath.split(separator) {
                    if !entry.is_empty() {
                        let _ = path.call_method1("insert", (0, entry));
                        info!("[DEPTH] Added PYTHONPATH entry: {}", entry);
                    }
                }
            }

            // Add DEPTH_SITE_PACKAGES if set (explicit venv site-packages)
            if let Ok(site_packages) = std::env::var("DEPTH_SITE_PACKAGES") {
                let _ = path.call_method1("insert", (0, site_packages.as_str()));
                info!("[DEPTH] Added site-packages: {}", site_packages);
            }
        }
    });
}

impl DepthModel {
    /// Initialize the depth model (call once at startup)
    pub fn new() -> anyhow::Result<Self> {
        // Setup environment first
        let python_dir = setup_python_env()?;

        Python::with_gil(|py| {
            // Add python directory to path
            let sys = py.import("sys")?;
            let path = sys.getattr("path")?;
            let dir_str = python_dir.to_string_lossy();
            path.call_method1("insert", (0, dir_str.as_ref()))?;

            // Try ONNX estimator first (much faster), fall back to PyTorch
            let estimator = match py.import("depth_estimator_onnx") {
                Ok(module) => {
                    info!("[DEPTH] Using ONNX Runtime backend");
                    module.getattr("DepthEstimator")?.call0()?
                }
                Err(e) => {
                    warn!(
                        "[DEPTH] ONNX not available ({}), falling back to PyTorch",
                        e
                    );
                    let module = py.import("depth_estimator")?;
                    module.getattr("DepthEstimator")?.call0()?
                }
            };

            info!("[DEPTH] Model loaded successfully");

            Ok(Self {
                estimator: estimator.into(),
            })
        })
    }

    /// Run depth inference on JPEG bytes, returns grayscale depth buffer
    pub fn estimate(&self, jpeg_bytes: &[u8]) -> anyhow::Result<Vec<u8>> {
        Python::with_gil(|py| {
            let input = PyBytes::new(py, jpeg_bytes);
            let result = self.estimator.call_method1(py, "estimate", (input,))?;

            let depth_bytes: Vec<u8> = result.extract(py)?;
            Ok(depth_bytes)
        })
    }
}

/// Thread-safe wrapper for the depth model
pub type SharedDepthModel = Arc<Mutex<Option<DepthModel>>>;

/// Initialize the global depth model
pub async fn init_depth_model() -> SharedDepthModel {
    let model = Arc::new(Mutex::new(None));

    // Load model in blocking task to not block async runtime
    let model_clone = model.clone();
    let result = tokio::task::spawn_blocking(move || match DepthModel::new() {
        Ok(m) => Some(m),
        Err(e) => {
            error!("[DEPTH] Failed to load model: {}", e);
            error!("[DEPTH] Server depth mode will not be available");
            None
        }
    })
    .await;

    if let Ok(Some(m)) = result {
        *model_clone.lock().await = Some(m);
        info!("[DEPTH] Model initialized and ready");
    }

    model
}

/// Run depth inference (call from WebSocket handler)
pub async fn run_depth_inference(
    model: &SharedDepthModel,
    jpeg_bytes: Vec<u8>,
) -> anyhow::Result<Vec<u8>> {
    let model = model.clone();

    // Run inference in blocking task to not hold GIL on async runtime
    tokio::task::spawn_blocking(move || {
        let guard = model.blocking_lock();

        match guard.as_ref() {
            Some(m) => m.estimate(&jpeg_bytes),
            None => Err(anyhow::anyhow!("Depth model not initialized")),
        }
    })
    .await?
}
