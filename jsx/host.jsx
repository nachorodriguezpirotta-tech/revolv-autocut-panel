// Revolv AutoCut — lado ExtendScript (corre dentro de Premiere)
// Dos responsabilidades:
//   1. getSelectedClipInfo(): datos del clip seleccionado en el timeline
//   2. applyCuts(json): extract (ripple delete) de cada rango de silencio
//
// Técnica de corte: setInPoint/setOutPoint + qe.extract() por cada gap,
// de atrás hacia adelante para que los tiempos no se corran.
// Extract es el ripple delete nativo de Premiere: corta en todos los
// tracks targeteados y cierra el hueco manteniendo el sync video/audio.

function getSelectedClipInfo() {
  try {
    var seq = app.project.activeSequence;
    if (!seq) return '{"error":"no_sequence"}';

    var selection = seq.getSelection();
    if (!selection || selection.length === 0) return '{"error":"no_selection"}';

    // Buscar el primer item seleccionado que tenga media real
    var clip = null;
    for (var i = 0; i < selection.length; i++) {
      if (selection[i].projectItem && selection[i].mediaType !== "Any") {
        clip = selection[i];
        break;
      }
    }
    if (!clip) clip = selection[0];
    if (!clip.projectItem) return '{"error":"no_media"}';

    var path = clip.projectItem.getMediaPath();
    if (!path) return '{"error":"no_path"}';

    // Escapar el path para JSON (backslashes de Windows y comillas)
    var safePath = path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

    return '{"path":"' + safePath + '"' +
           ',"start":' + clip.start.seconds +
           ',"end":' + clip.end.seconds +
           ',"inPoint":' + clip.inPoint.seconds +
           ',"outPoint":' + clip.outPoint.seconds +
           ',"name":"' + clip.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' +
           '}';
  } catch (e) {
    return '{"error":"jsx","detail":"' + e.toString().replace(/"/g, "'") + '"}';
  }
}

// gapsJson: array de {start, end} en segundos de TIMELINE (ya convertidos
// por el panel), ordenados ascendente. anchorSeconds: donde dejar el playhead.
function applyCuts(gapsJson, anchorSeconds) {
  try {
    var gaps = eval("(" + gapsJson + ")");
    if (!gaps || gaps.length === 0) return '{"error":"no_gaps"}';

    var seq = app.project.activeSequence;
    if (!seq) return '{"error":"no_sequence"}';

    app.enableQE();
    var qeSeq = qe.project.getActiveSequence();

    // Targetear todos los tracks para que el extract corte parejo
    // (video + audio juntos = nunca se desincroniza)
    for (var v = 0; v < seq.videoTracks.numTracks; v++) {
      seq.videoTracks[v].setTargeted(true, true);
    }
    for (var a = 0; a < seq.audioTracks.numTracks; a++) {
      seq.audioTracks[a].setTargeted(true, true);
    }

    // Deseleccionar clips: con selección activa, extract puede comportarse raro
    var sel = seq.getSelection();
    if (sel) {
      for (var s = 0; s < sel.length; s++) {
        try { sel[s].setSelected(0, 0); } catch (e1) {}
      }
    }

    // Cortar de atrás hacia adelante
    var cuts = 0;
    for (var i = gaps.length - 1; i >= 0; i--) {
      var gStart = parseFloat(gaps[i].start);
      var gEnd = parseFloat(gaps[i].end);
      if (!(gEnd > gStart)) continue;
      seq.setInPoint(gStart);
      seq.setOutPoint(gEnd);
      qeSeq.extract();
      cuts++;
    }

    // Limpiar in/out y volver el playhead al inicio del clip
    var anchor = parseFloat(anchorSeconds) || 0;
    seq.setInPoint(anchor);
    seq.setOutPoint(anchor);
    var TICKS_PER_SECOND = 254016000000;
    seq.setPlayerPosition(String(Math.round(anchor * TICKS_PER_SECOND)));

    return '{"ok":true,"cuts":' + cuts + '}';
  } catch (e) {
    return '{"error":"jsx","detail":"' + e.toString().replace(/"/g, "'") + '"}';
  }
}
