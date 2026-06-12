/* Revolv AutoCut — lógica del panel.
 *
 * Flujo del botón:
 *   1. ExtendScript: datos del clip seleccionado (path, start, in/out)
 *   2. Node: corre helper/detect_silences.py (ffmpeg + faster-whisper)
 *      → silencios detectados por huecos ENTRE PALABRAS, no por dB
 *   3. Convierte los gaps de tiempo de archivo → tiempo de timeline
 *   4. ExtendScript: extract (ripple delete) de cada gap, de atrás
 *      hacia adelante. El video queda pegado, sin pausas.
 */

(function () {
  "use strict";

  var VERSION = "1.1.0";
  var UPDATE_RAW = "https://raw.githubusercontent.com/nachorodriguezpirotta-tech/revolv-autocut-panel/main/version.json";
  var UPDATE_ZIP = "https://codeload.github.com/nachorodriguezpirotta-tech/revolv-autocut-panel/zip/refs/heads/main";

  var inPremiere = typeof window.__adobe_cep__ !== "undefined";
  var cs = inPremiere ? new CSInterface() : null;

  // Node dentro de CEP: según versión expone require global o cep_node
  var nodeRequire = null;
  if (typeof cep_node !== "undefined" && cep_node.require) {
    nodeRequire = cep_node.require;
  } else if (typeof require !== "undefined") {
    nodeRequire = require;
  }

  var running = false;

  // ───────── helpers DOM ─────────
  function $(id) { return document.getElementById(id); }

  function setStatus(msg, kind) {
    var el = $("status");
    el.textContent = msg || "";
    el.className = "status " + (kind || "");
  }

  function setProgress(pct) {
    $("bar").style.width = Math.max(0, Math.min(100, pct)) + "%";
    $("progressWrap").style.display = pct > 0 ? "block" : "none";
  }

  function log(msg) {
    var el = $("log");
    var line = document.createElement("div");
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
    el.style.display = "block";
  }

  function clearLog() {
    $("log").innerHTML = "";
    $("log").style.display = "none";
  }

  function fmtSecs(s) {
    s = Math.round(s);
    var m = Math.floor(s / 60);
    return m > 0 ? m + "m " + (s % 60) + "s" : s + "s";
  }

  function setRunning(on) {
    running = on;
    $("cutBtn").disabled = on;
    $("cutBtn").textContent = on ? "Procesando…" : "✂️ AutoCut";
  }

  // ───────── ExtendScript bridge ─────────
  function evalJsx(code, cb) {
    cs.evalScript(code, function (res) {
      var parsed = null;
      try { parsed = JSON.parse(res); }
      catch (e) { parsed = { error: "parse", detail: String(res) }; }
      cb(parsed);
    });
  }

  // ───────── detección (proceso Python local) ─────────
  function pythonCandidates(fs, isWin) {
    if (isWin) {
      // "py" es el launcher oficial; "python" suele estar en PATH.
      // OJO: el alias de Microsoft Store se llama python pero no sirve —
      // si falla, el .bat de instalación ya avisó cómo instalar Python.
      return ["py", "python"];
    }
    var macs = ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"];
    var out = [];
    for (var i = 0; i < macs.length; i++) {
      try { if (fs.existsSync(macs[i])) out.push(macs[i]); } catch (e) {}
    }
    out.push("python3");
    return out;
  }

  function runDetection(videoPath, settings, onProgress, cb) {
    if (!nodeRequire) {
      cb({ error: "Node no está habilitado en el panel. Reinstalá la extensión (manifest sin --enable-nodejs)." });
      return;
    }
    var cp = nodeRequire("child_process");
    var pathMod = nodeRequire("path");
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var isWin = os.platform() === "win32";

    var extDir = cs.getSystemPath(SystemPath.EXTENSION);
    var script = pathMod.join(extDir, "helper", "detect_silences.py");

    var args = [
      script, videoPath,
      "--min-silence", String(settings.minSilence),
      "--padding-out", String(settings.padOut),
      "--padding-in", String(settings.padIn),
      "--language", settings.language,
      "--model", settings.model
    ];

    var sep = isWin ? ";" : ":";
    var home = process.env.HOME || process.env.USERPROFILE || "";
    var extraPath = isWin
      ? [pathMod.join(extDir, "helper"), pathMod.join(home, "bin")]
      : ["/opt/homebrew/bin", "/usr/local/bin", pathMod.join(home, "bin")];
    var env = Object.assign({}, process.env, {
      PATH: (process.env.PATH || "") + sep + extraPath.join(sep)
    });

    var candidates = pythonCandidates(fs, isWin);

    function tryRun(idx) {
      if (idx >= candidates.length) {
        cb({ error: isWin
          ? "No encontré Python. Instalalo desde python.org marcando 'Add to PATH' y reabrí Premiere."
          : "No pude ejecutar python3." });
        return;
      }

      var proc = cp.spawn(candidates[idx], args, { env: env });
      var stdout = "", stderrTail = "", failed = false;

      proc.stdout.on("data", function (d) { stdout += d.toString(); });

      proc.stderr.on("data", function (d) {
        var lines = d.toString().split("\n");
        for (var i = 0; i < lines.length; i++) {
          var m = lines[i].match(/^PROGRESS:(\d+):(.*)$/);
          if (m) onProgress(parseInt(m[1], 10), m[2]);
          else if (lines[i].trim()) stderrTail = lines[i].trim();
        }
      });

      proc.on("error", function () {
        // Ese binario no existe → probar el siguiente candidato
        failed = true;
        tryRun(idx + 1);
      });

      proc.on("close", function (code) {
        if (failed) return;
        // El alias trucho de Microsoft Store sale con 9009 y sin output
        if (isWin && code !== 0 && !stdout.trim() && idx + 1 < candidates.length) {
          tryRun(idx + 1);
          return;
        }
        // El JSON es la última línea no vacía del stdout
        var lines = stdout.trim().split("\n");
        var jsonLine = lines[lines.length - 1] || "";
        var result = null;
        try { result = JSON.parse(jsonLine); } catch (e) {}

        if (result && result.error) { cb({ error: result.error }); return; }
        if (code !== 0 || !result) {
          cb({ error: "El detector falló (código " + code + "). " + (stderrTail || "") });
          return;
        }
        cb(null, result);
      });
    }

    tryRun(0);
  }

  // ───────── ffmpeg de emergencia ─────────
  // Si el helper no encontró ffmpeg (instalador no corrido o descarga
  // fallida), lo bajamos desde el panel y reintentamos solos.
  function ensureFfmpeg(onStatus, cb) {
    var cp = nodeRequire("child_process");
    var pathMod = nodeRequire("path");
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var isWin = os.platform() === "win32";

    var extDir = cs.getSystemPath(SystemPath.EXTENSION);
    var home = process.env.HOME || process.env.USERPROFILE || "";
    var tmp = os.tmpdir();

    function fail(msg) { cb({ error: msg }); }

    if (isWin) {
      var target = pathMod.join(extDir, "helper", "ffmpeg.exe");
      if (fs.existsSync(target)) { cb(null); return; }
      var zipPath = pathMod.join(tmp, "ffmpeg-rv.zip");
      var url = "https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip";

      onStatus("Descargando ffmpeg (~80MB, una sola vez)…");
      cp.execFile("curl", ["-L", "-o", zipPath, url], { timeout: 600000 }, function (err) {
        if (err) { fail("No pude descargar ffmpeg: " + err.message); return; }
        onStatus("Descomprimiendo ffmpeg…");
        cp.execFile("tar", ["-xf", zipPath, "-C", tmp], { timeout: 120000 }, function (err2) {
          if (err2) { fail("No pude descomprimir ffmpeg: " + err2.message); return; }
          try {
            var src = pathMod.join(tmp, "ffmpeg-master-latest-win64-gpl", "bin", "ffmpeg.exe");
            fs.copyFileSync(src, target);
            try { fs.unlinkSync(zipPath); } catch (e) {}
            cb(null);
          } catch (e2) {
            fail("No pude copiar ffmpeg.exe: " + e2.message);
          }
        });
      });
    } else {
      var binDir = pathMod.join(home, "bin");
      var targetMac = pathMod.join(binDir, "ffmpeg");
      if (fs.existsSync(targetMac)) { cb(null); return; }
      var zipMac = pathMod.join(tmp, "ffmpeg-rv.zip");

      onStatus("Descargando ffmpeg (~25MB, una sola vez)…");
      cp.execFile("curl", ["-L", "-o", zipMac, "https://evermeet.cx/ffmpeg/getrelease/zip"], { timeout: 600000 }, function (err) {
        if (err) { fail("No pude descargar ffmpeg: " + err.message); return; }
        try { fs.mkdirSync(binDir, { recursive: true }); } catch (e) {}
        cp.execFile("unzip", ["-o", "-q", zipMac, "-d", binDir], { timeout: 120000 }, function (err2) {
          if (err2) { fail("No pude descomprimir ffmpeg: " + err2.message); return; }
          try {
            fs.chmodSync(targetMac, 493 /* 0755 */);
            cp.execFile("xattr", ["-d", "com.apple.quarantine", targetMac], function () {});
            try { fs.unlinkSync(zipMac); } catch (e) {}
            cb(null);
          } catch (e2) {
            fail("ffmpeg quedó mal instalado: " + e2.message);
          }
        });
      });
    }
  }

  // ───────── conversión source → timeline ─────────
  // El helper devuelve gaps en segundos del ARCHIVO. El clip puede estar
  // recortado (inPoint > 0) o empezar en cualquier punto del timeline.
  function gapsToTimeline(gaps, clip) {
    var out = [];
    for (var i = 0; i < gaps.length; i++) {
      // Solo la parte del gap que cae dentro de lo que el clip muestra
      var s = Math.max(gaps[i].start, clip.inPoint);
      var e = Math.min(gaps[i].end, clip.outPoint);
      if (e - s < 0.05) continue;
      out.push({
        start: clip.start + (s - clip.inPoint),
        end: clip.start + (e - clip.inPoint)
      });
    }
    return out;
  }

  // ───────── flujo principal ─────────
  function autocut() {
    if (running) return;
    if (!inPremiere) { setStatus("Abrí esto dentro de Premiere.", "err"); return; }

    var settings = {
      minSilence: parseFloat($("minSilence").value) || 0.7,
      padOut: parseFloat($("padOut").value) || 0.2,
      padIn: parseFloat($("padIn").value) >= 0 ? parseFloat($("padIn").value) : 0.05,
      model: $("model").value,
      language: $("language").value
    };
    localStorage.setItem("rv_autocut_settings", JSON.stringify(settings));

    clearLog();
    setRunning(true);
    setProgress(2);
    setStatus("Leyendo clip seleccionado…");

    evalJsx("getSelectedClipInfo()", function (clip) {
      if (clip.error) {
        setRunning(false); setProgress(0);
        var msgs = {
          no_sequence: "No hay secuencia activa. Abrí una primero.",
          no_selection: "Seleccioná el clip en el timeline (click sobre el clip).",
          no_media: "El clip seleccionado no tiene archivo asociado.",
          no_path: "No pude obtener el path del archivo del clip."
        };
        setStatus(msgs[clip.error] || ("Error: " + (clip.detail || clip.error)), "err");
        return;
      }

      log("🎬 " + clip.name);
      setStatus("Detectando palabras y silencios…");

      var detect = function (allowFfmpegFix) {
      runDetection(clip.path, settings, function (pct, msg) {
        setProgress(pct * 0.9); // dejar 10% para el corte
        if (msg) setStatus(msg);
      }, function (err, result) {
        if (err && allowFfmpegFix && /ffmpeg/i.test(err.error)) {
          // ffmpeg no está: lo bajamos nosotros y reintentamos solos
          ensureFfmpeg(function (msg) { setStatus(msg); }, function (ffErr) {
            if (ffErr) {
              setRunning(false); setProgress(0);
              setStatus(ffErr.error, "err");
              return;
            }
            log("📦 ffmpeg instalado automáticamente");
            setStatus("Detectando palabras y silencios…");
            detect(false);
          });
          return;
        }
        if (err) {
          setRunning(false); setProgress(0);
          setStatus(err.error, "err");
          return;
        }

        var tlGaps = gapsToTimeline(result.gaps, clip);
        log("🗣 " + result.words + " palabras detectadas");
        log("🔇 " + tlGaps.length + " silencios dentro del clip");

        if (tlGaps.length === 0) {
          setRunning(false); setProgress(0);
          setStatus("No encontré pausas para cortar (mín. " + settings.minSilence + "s). Probá bajar la pausa mínima.", "ok");
          return;
        }

        setStatus("Cortando " + tlGaps.length + " pausas…");
        setProgress(95);

        var gapsJson = JSON.stringify(tlGaps).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        evalJsx('applyCuts("' + gapsJson + '", ' + clip.start + ')', function (res) {
          setRunning(false);
          setProgress(0);
          if (res.error) {
            setStatus("Error al cortar: " + (res.detail || res.error), "err");
            return;
          }
          var saved = 0;
          for (var i = 0; i < tlGaps.length; i++) saved += tlGaps[i].end - tlGaps[i].start;
          log("✂️ " + res.cuts + " cortes hechos");
          log("⏱ " + fmtSecs(saved) + " de pausas eliminadas");
          setStatus("¡Listo! " + res.cuts + " cortes, " + fmtSecs(saved) + " menos de video. (Deshacer: Cmd+Z varias veces)", "ok");
        });
      });
      };

      detect(true);
    });
  }

  // ───────── auto-update ─────────
  // Al abrir el panel chequea version.json en GitHub. Si hay versión
  // nueva, baja el repo, se sobreescribe a sí mismo y avisa que hay que
  // reiniciar Premiere. Falla en silencio (reintenta al próximo open).
  function newerThan(remote, local) {
    var r = String(remote).split("."), l = String(local).split(".");
    for (var i = 0; i < Math.max(r.length, l.length); i++) {
      var a = parseInt(r[i] || "0", 10), b = parseInt(l[i] || "0", 10);
      if (a > b) return true;
      if (a < b) return false;
    }
    return false;
  }

  function copyDirInto(fs, pathMod, src, dst) {
    var entries = fs.readdirSync(src);
    for (var i = 0; i < entries.length; i++) {
      var name = entries[i];
      if (name === ".git" || name === ".DS_Store") continue;
      var s = pathMod.join(src, name), d = pathMod.join(dst, name);
      if (fs.statSync(s).isDirectory()) {
        try { fs.mkdirSync(d); } catch (e) {}
        copyDirInto(fs, pathMod, s, d);
      } else {
        fs.writeFileSync(d, fs.readFileSync(s));
      }
    }
  }

  function applyUpdate(newVersion) {
    var cp = nodeRequire("child_process");
    var pathMod = nodeRequire("path");
    var fs = nodeRequire("fs");
    var os = nodeRequire("os");
    var extDir = cs.getSystemPath(SystemPath.EXTENSION);
    var tmp = os.tmpdir();
    var zipPath = pathMod.join(tmp, "rv-autocut-update.zip");

    setStatus("⬇️ Actualizando panel a v" + newVersion + "…");
    cp.execFile("curl", ["-L", "-o", zipPath, UPDATE_ZIP], { timeout: 300000 }, function (err) {
      if (err) { setStatus(""); return; }
      cp.execFile("tar", ["-xf", zipPath, "-C", tmp], { timeout: 60000 }, function (err2) {
        if (err2) { setStatus(""); return; }
        try {
          copyDirInto(fs, pathMod, pathMod.join(tmp, "revolv-autocut-panel-main"), extDir);
          try { fs.unlinkSync(zipPath); } catch (e) {}
          setStatus("✅ Panel actualizado a v" + newVersion + " — cerrá y volvé a abrir Premiere", "ok");
        } catch (e3) { setStatus(""); }
      });
    });
  }

  function checkForUpdate() {
    if (!inPremiere || !nodeRequire || running) return;
    var xhr = new XMLHttpRequest();
    xhr.open("GET", UPDATE_RAW + "?t=" + Date.now(), true);
    xhr.timeout = 15000;
    xhr.onreadystatechange = function () {
      if (xhr.readyState !== 4 || xhr.status !== 200) return;
      var remote = null;
      try { remote = JSON.parse(xhr.responseText); } catch (e) { return; }
      if (remote && remote.version && newerThan(remote.version, VERSION)) {
        applyUpdate(remote.version);
      }
    };
    try { xhr.send(); } catch (e) {}
  }

  // ───────── settings persistidos ─────────
  try {
    var saved = JSON.parse(localStorage.getItem("rv_autocut_settings") || "{}");
    if (saved.minSilence) $("minSilence").value = saved.minSilence;
    // migración: "padding" viejo (simétrico) pasa a ser el aire de salida
    if (saved.padOut) $("padOut").value = saved.padOut;
    else if (saved.padding) $("padOut").value = saved.padding;
    if (saved.padIn != null) $("padIn").value = saved.padIn;
    if (saved.model) $("model").value = saved.model;
    if (saved.language) $("language").value = saved.language;
  } catch (e) {}

  $("cutBtn").addEventListener("click", autocut);
  $("toggleSettings").addEventListener("click", function () {
    var s = $("settings");
    s.style.display = s.style.display === "block" ? "none" : "block";
  });

  var verEl = $("ver");
  if (verEl) verEl.textContent = "v" + VERSION;

  if (!inPremiere) setStatus("Modo preview (fuera de Premiere)", "");
  checkForUpdate();
})();
