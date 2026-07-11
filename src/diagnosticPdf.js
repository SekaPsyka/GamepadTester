import { getTheme } from "./storage.js";
import { THEMES } from "./themes.js";
import {
  NEUTRAL_DRIFT_WARN_THRESHOLD,
  triggerStabilityGrade,
} from "./gamepad.js";
import { buildMashVerdict, gradeForChatter } from "./mashTest.js";
import { reliabilityAdjective } from "./diagnosticSummary.js";
import { computeDiagnosticVerdict, GRADE_STATUS } from "./diagnosticReport.js";
const PDF_MARGIN = 15;
const PDF_PAGE_WIDTH = 210;
const PDF_CONTENT_WIDTH = PDF_PAGE_WIDTH - PDF_MARGIN * 2;
const PDF_DARK = [30, 32, 40];
const PDF_MUTED = [110, 110, 110];
const PDF_LABEL = [85, 87, 95];
const PDF_HAIRLINE = [188, 191, 199];

const PDF_STATUS_COLORS = {
  ok: [30, 150, 90],
  warn: [200, 140, 0],
  bad: [200, 50, 50],
  neutral: [140, 140, 140],
};
const PDF_STATUS_LABELS = { ok: "OK", warn: "ATTENTION", bad: "PROBLÈME", neutral: "N/A" };
// Glyphes ASCII uniquement: les polices de base de jsPDF (WinAnsi) n'incluent pas ✓/✕.
const PDF_STATUS_GLYPHS = { ok: "+", warn: "!", bad: "x", neutral: "-" };

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

// Les couleurs de thème sont des néons saturés (ex: cyan, ambre) qui ne garantissent pas
// un contraste correct avec du texte blanc fixe: on choisit la couleur de texte selon la
// luminance perçue plutôt que de supposer que "couleur vive = texte blanc lisible".
function textColorForBackground([r, g, b]) {
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? [20, 20, 25] : [255, 255, 255];
}

export function slugify(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function pdfEnsureSpace(doc, y, needed) {
  if (y + needed > 278) {
    doc.addPage();
    return 18;
  }
  return y;
}

// En-tête de section "discret": une fine barre d'accent + libellé tracké, plutôt qu'un
// bandeau plein qui donnait le même poids visuel à chaque section du rapport.
function pdfPanelHeader(doc, title, y, accent) {
  y = pdfEnsureSpace(doc, y, 14);
  doc.setFillColor(...accent);
  doc.rect(PDF_MARGIN, y, 1.2, 6, "F");
  doc.setTextColor(...PDF_DARK);
  doc.setFont(undefined, "bold");
  doc.setFontSize(10.5);
  doc.text(title.toUpperCase(), PDF_MARGIN + 4, y + 4.6, { charSpace: 0.3 });
  doc.setFont(undefined, "normal");
  return y + 6 + 6;
}

function pdfDivider(doc, y) {
  doc.setDrawColor(...PDF_HAIRLINE);
  doc.setLineWidth(0.2);
  doc.line(PDF_MARGIN, y, PDF_PAGE_WIDTH - PDF_MARGIN, y);
  return y + 7;
}

// Clin d'œil discret à l'objet du rapport: un badge carré arrondi façon bouton de
// manette, plutôt qu'une simple puce de couleur, pour marquer chaque verdict.
function pdfStatusChip(doc, status, x, y) {
  doc.setFillColor(...PDF_STATUS_COLORS[status]);
  doc.roundedRect(x, y, 4.2, 4.2, 1, 1, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont(undefined, "bold");
  doc.setFontSize(7);
  doc.text(PDF_STATUS_GLYPHS[status], x + 2.1, y + 3, { align: "center" });
}

function pdfVerdictRow(doc, item, y) {
  const lines = doc.splitTextToSize(item.text, PDF_CONTENT_WIDTH - 10);
  y = pdfEnsureSpace(doc, y, lines.length * 4.3 + 7);

  pdfStatusChip(doc, item.status, PDF_MARGIN, y);

  doc.setFont(undefined, "bold");
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_DARK);
  doc.text(item.title, PDF_MARGIN + 7, y + 3.2);
  const titleWidth = doc.getTextWidth(item.title);
  doc.setFont(undefined, "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...PDF_STATUS_COLORS[item.status]);
  doc.text(item.label?.toUpperCase() || PDF_STATUS_LABELS[item.status], PDF_MARGIN + 7 + titleWidth + 3, y + 3.2);
  y += 5.5;

  doc.setFontSize(9);
  doc.setFont(undefined, "normal");
  doc.setTextColor(...PDF_DARK);
  doc.text(lines, PDF_MARGIN + 7, y);
  y += lines.length * 4.3 + 4;
  return y;
}

// Carte "instrument": grande valeur en police mono (comme les lectures brutes affichées
// à l'écran dans l'app) + libellé tracké, pour une lecture immédiate sans avoir à lire
// de phrases. Une fine bande de couleur en haut porte le statut (ok/attention/problème).
function pdfKpiCard(doc, x, y, w, h, { label, value, status }) {
  doc.setDrawColor(...PDF_HAIRLINE);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, w, h, 1.5, 1.5, "S");
  doc.setFillColor(...PDF_STATUS_COLORS[status]);
  doc.rect(x + 0.6, y, w - 1.2, 1.3, "F");

  doc.setFont("courier", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(...PDF_DARK);
  doc.text(value, x + w / 2, y + h / 2 + 0.5, { align: "center" });

  doc.setFont(undefined, "bold");
  doc.setFontSize(7.2);
  doc.setTextColor(...PDF_LABEL);
  doc.text(label.toUpperCase(), x + w / 2, y + h - 3.2, { align: "center", charSpace: 0.15 });
}

export function buildDiagnosticPdf(report, jsPDF, autoTable) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // Couleur d'accent alignée sur le thème actif au moment de l'export, pour que le rapport
  // PDF reste visuellement rattaché à l'application plutôt que d'imposer une charte fixe.
  // Réservée à la couverture, aux libellés de section et aux en-têtes de tableau: les
  // statuts (ok/attention/problème) restent des couleurs sémantiques fixes, jamais teintées.
  const activeTheme = THEMES[getTheme()] || THEMES.cyan;
  const PDF_ACCENT = hexToRgb(activeTheme.accent);
  const PDF_ACCENT_TEXT = textColorForBackground(PDF_ACCENT);

  const titleText = report.gamepad ? `Rapport de diagnostic — ${report.gamepad.id}` : "Rapport de diagnostic manette";
  doc.setFont(undefined, "bold");
  doc.setFontSize(17);
  const titleLines = doc.splitTextToSize(titleText, PDF_CONTENT_WIDTH);
  const coverHeight = 12 + titleLines.length * 7 + 9;
  doc.setFillColor(...PDF_ACCENT);
  doc.rect(0, 0, PDF_PAGE_WIDTH, coverHeight, "F");
  doc.setTextColor(...PDF_ACCENT_TEXT);
  doc.text(titleLines, PDF_MARGIN, 11);
  doc.setFont(undefined, "normal");
  doc.setFontSize(9.5);
  doc.text(`Généré le ${new Date(report.generatedAt).toLocaleString("fr-FR")}`, PDF_MARGIN, 11 + titleLines.length * 7 + 5);
  let y = coverHeight + 10;

  const verdictItems = computeDiagnosticVerdict(report);

  const chatterValue = String(report.chatterEventsTotal);
  const chatterStatus = verdictItems.find((i) => i.title === "Observation libre des boutons" || i.title === "Doubles déclenchements")?.status ?? "neutral";

  let mashValue = "N/A";
  let mashStatus = "neutral";
  if (report.mashTest && report.mashTest.length) {
    const totalPressCount = report.mashTest.reduce((sum, r) => sum + r.pressCount, 0);
    const totalChatter = report.mashTest.reduce((sum, r) => sum + r.chatterCount, 0);
    const overallGrade = gradeForChatter(totalChatter, totalPressCount);
    mashValue = reliabilityAdjective(overallGrade, { capitalized: true });
    mashStatus = GRADE_STATUS[overallGrade.key];
  }

  const hasBadVerdict = verdictItems.some((i) => i.status === "bad");
  const hasWarnVerdict = verdictItems.some((i) => i.status === "warn");
  const hasNeutralVerdict = verdictItems.some((i) => i.status === "neutral");
  const globalStatus = hasBadVerdict ? "bad" : hasWarnVerdict ? "warn" : hasNeutralVerdict ? "neutral" : "ok";
  const globalValue = hasBadVerdict ? "Problème" : hasWarnVerdict ? "Attention" : hasNeutralVerdict ? "Incomplet" : "Cohérent";
  const measuredItems = verdictItems.filter((item) => item.status !== "neutral").length;

  y = pdfEnsureSpace(doc, y, 26);
  const kpis = [
    { label: "Mesures disponibles", value: `${measuredItems}/${verdictItems.length}`, status: hasNeutralVerdict ? "neutral" : "ok" },
    { label: "Doubles déclenchements", value: chatterValue, status: chatterStatus },
    { label: "Fiabilité boutons", value: mashValue, status: mashStatus },
    { label: "Synthèse", value: globalValue, status: globalStatus },
  ];
  const kpiGap = 4;
  const kpiWidth = (PDF_CONTENT_WIDTH - kpiGap * (kpis.length - 1)) / kpis.length;
  const kpiHeight = 22;
  kpis.forEach((kpi, i) => pdfKpiCard(doc, PDF_MARGIN + i * (kpiWidth + kpiGap), y, kpiWidth, kpiHeight, kpi));
  y += kpiHeight + 10;

  y = pdfEnsureSpace(doc, y, 24);
  y = pdfPanelHeader(doc, "Résumé du diagnostic", y, PDF_ACCENT);
  for (const item of verdictItems) {
    y = pdfVerdictRow(doc, item, y);
  }
  y = pdfDivider(doc, y + 2);

  y = pdfEnsureSpace(doc, y, 36);
  y = pdfPanelHeader(doc, "Manette & zones mortes", y, PDF_ACCENT);
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_DARK);
  if (report.gamepad) {
    doc.setFont(undefined, "bold");
    doc.text("Nom", PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    doc.text(report.gamepad.id, PDF_MARGIN + 18, y);
    y += 5.5;
    doc.setFont(undefined, "bold");
    doc.text("Mapping", PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    doc.text(
      `${report.gamepad.mapping} · ${report.gamepad.buttonCount} boutons · ${report.gamepad.axisCount} axes`,
      PDF_MARGIN + 18,
      y
    );
    y += 7;
  } else {
    doc.text("Aucune manette connectée au moment de l'export.", PDF_MARGIN + 2, y);
    y += 7;
  }
  autoTable(doc, {
    startY: y,
    margin: { left: PDF_MARGIN, right: PDF_MARGIN },
    head: [["Stick", "Zone morte intérieure", "Zone morte extérieure"]],
    body: [
      ["Gauche", report.deadzones.left.inner.toFixed(2), report.deadzones.left.outer.toFixed(2)],
      ["Droit", report.deadzones.right.inner.toFixed(2), report.deadzones.right.outer.toFixed(2)],
    ],
    theme: "grid",
    headStyles: { fillColor: PDF_ACCENT, textColor: PDF_ACCENT_TEXT, fontSize: 9 },
    styles: { fontSize: 9.5, textColor: PDF_DARK },
    columnStyles: {
      1: { font: "courier", halign: "right" },
      2: { font: "courier", halign: "right" },
    },
  });
  y = pdfDivider(doc, doc.lastAutoTable.finalY + 8);

  y = pdfEnsureSpace(doc, y, 52);
  y = pdfPanelHeader(doc, "Sticks — calibration & point neutre", y, PDF_ACCENT);
  const colGap = 6;
  const colWidth = (PDF_CONTENT_WIDTH - colGap) / 2;
  const sides = [
    { key: "left", label: "Gauche", x: PDF_MARGIN },
    { key: "right", label: "Droit", x: PDF_MARGIN + colWidth + colGap },
  ];
  const sticksStartY = y;
  let sticksEndY = y;
  for (const side of sides) {
    let cy = sticksStartY;
    doc.setFont(undefined, "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_DARK);
    doc.text(side.label.toUpperCase(), side.x, cy, { charSpace: 0.2 });
    cy += 5;

    doc.setFont(undefined, "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...PDF_DARK);
    const calibText = report.calibration[side.key]?.message || "Aucune calibration effectuée.";
    const calibLines = doc.splitTextToSize(calibText, colWidth);
    doc.text(calibLines, side.x, cy);
    cy += calibLines.length * 4 + 4;

    const offset = report.neutralDrift[side.key];
    const drifted = offset.measured && offset.magnitude > NEUTRAL_DRIFT_WARN_THRESHOLD;
    const neutralText = offset.measured
      ? `Point neutre: ${offset.x.toFixed(3)}, ${offset.y.toFixed(3)} ${drifted ? "(décalé)" : "(centré)"}`
      : "Point neutre: pas encore mesuré.";
    const neutralLines = doc.splitTextToSize(neutralText, colWidth);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(drifted ? PDF_STATUS_COLORS.warn : PDF_MUTED));
    doc.text(neutralLines, side.x, cy);
    cy += neutralLines.length * 4 + 2;

    sticksEndY = Math.max(sticksEndY, cy);
  }
  doc.setFont(undefined, "normal");
  y = pdfDivider(doc, sticksEndY + 3);

  y = pdfEnsureSpace(doc, y, 36);
  y = pdfPanelHeader(doc, "Gâchettes — stabilité du signal", y, PDF_ACCENT);
  const triggerSides = [
    { key: "lt", label: "LT / L2", x: PDF_MARGIN },
    { key: "rt", label: "RT / R2", x: PDF_MARGIN + colWidth + colGap },
  ];
  const triggersStartY = y;
  let triggersEndY = y;
  for (const side of triggerSides) {
    let cy = triggersStartY;
    doc.setFont(undefined, "bold");
    doc.setFontSize(9);
    doc.setTextColor(...PDF_DARK);
    doc.text(side.label.toUpperCase(), side.x, cy, { charSpace: 0.2 });
    cy += 5;

    const result = report.triggerStability[side.key];
    const grade = triggerStabilityGrade(result);
    const qualifier =
      grade.key === "poor" ? "(instable)" : grade.key === "fair" ? (grade.isolated ? "(écart isolé, à confirmer)" : "(léger bruit)") : "(lisse)";
    const stabilityText = result.measured
      ? `Écart à palier tenu: ${(result.range * 100).toFixed(1)}% (${result.stepCount} saut(s)) ${qualifier}`
      : "Pas encore mesuré (maintenez à mi-course).";
    const stabilityLines = doc.splitTextToSize(stabilityText, colWidth);
    doc.setFont("courier", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...(grade.key === "poor" ? PDF_STATUS_COLORS.bad : grade.key === "fair" ? PDF_STATUS_COLORS.warn : PDF_MUTED));
    doc.text(stabilityLines, side.x, cy);
    cy += stabilityLines.length * 4 + 2;

    triggersEndY = Math.max(triggersEndY, cy);
  }
  doc.setFont(undefined, "normal");
  const vibrationText = !report.vibration?.supported
    ? "Vibrations : non applicables avec cette manette ou ce navigateur."
    : report.vibration.commands.strong === "complete" && report.vibration.commands.weak === "complete"
      ? "Commandes de vibration envoyées aux deux moteurs à 100 % pendant 600 ms. La force réellement produite n'est pas mesurable par l'application."
      : "Commandes de vibration incomplètes ou interrompues ; aucune conclusion matérielle n'est possible.";
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_MUTED);
  const vibrationLines = doc.splitTextToSize(vibrationText, PDF_CONTENT_WIDTH - 4);
  doc.text(vibrationLines, PDF_MARGIN + 2, triggersEndY + 3);
  y = pdfDivider(doc, triggersEndY + 4 + vibrationLines.length * 4);

  y = pdfEnsureSpace(doc, y, 32);
  y = pdfPanelHeader(doc, "Doubles déclenchements observés", y, PDF_ACCENT);
  doc.setFontSize(9.5);
  doc.setTextColor(...PDF_DARK);
  doc.setFont(undefined, "bold");
  doc.text("Événements détectés", PDF_MARGIN + 2, y);
  doc.setFont("courier", "normal");
  doc.text(`${report.chatterEventsTotal} événement(s)`, PDF_MARGIN + 40, y);
  doc.setFont(undefined, "normal");
  y += 8;

  if (report.chatterByButton.length > 0) {
    y = pdfEnsureSpace(doc, y, 16);
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Bouton", "Appuis", "Chatter", "Taux"]],
      body: report.chatterByButton.map((b) => [
        b.label,
        String(b.pressCount),
        String(b.count),
        `${Math.round((b.count / b.pressCount) * 100)}%`,
      ]),
      theme: "grid",
      headStyles: { fillColor: PDF_DARK, textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, textColor: PDF_DARK },
      columnStyles: {
        1: { font: "courier", halign: "right" },
        2: { font: "courier", halign: "right" },
        3: { font: "courier", halign: "right" },
      },
    });
    y = doc.lastAutoTable.finalY + 8;
  } else {
    y += 2;
  }
  y = pdfDivider(doc, y);

  y = pdfEnsureSpace(doc, y, 30);
  y = pdfPanelHeader(doc, "Diagnostic guidé des boutons", y, PDF_ACCENT);
  if (report.mashTest && report.mashTest.length) {
    const totalPressCount = report.mashTest.reduce((sum, r) => sum + r.pressCount, 0);
    const totalChatter = report.mashTest.reduce((sum, r) => sum + r.chatterCount, 0);
    const overallGrade = gradeForChatter(totalChatter, totalPressCount);
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_STATUS_COLORS[GRADE_STATUS[overallGrade.key]]);
    doc.setFont(undefined, "bold");
    doc.text(`Fiabilité globale : ${reliabilityAdjective(overallGrade, { capitalized: true })} (${totalChatter} double(s) déclenchement(s) sur ${totalPressCount} appuis)`, PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    y += 7;
    const mashGrades = report.mashTest.map((r) => gradeForChatter(r.chatterCount, r.pressCount));
    const unreliableLabels = report.mashTest.filter((r) => r.reliable === false).map((r) => r.label);
    autoTable(doc, {
      startY: y,
      margin: { left: PDF_MARGIN, right: PDF_MARGIN },
      head: [["Bouton", "Appuis", "Appuis/s", "Doubles", "Fiabilité"]],
      body: report.mashTest.map((r, i) => [
        r.label,
        String(r.pressCount),
        r.pressesPerSecond.toFixed(1),
        String(r.chatterCount),
        r.reliable === false ? `${mashGrades[i].label} (*)` : mashGrades[i].label,
      ]),
      theme: "grid",
      headStyles: { fillColor: PDF_DARK, textColor: 255, fontSize: 9 },
      styles: { fontSize: 9, textColor: PDF_DARK },
      columnStyles: {
        1: { font: "courier", halign: "right" },
        2: { font: "courier", halign: "right" },
        3: { font: "courier", halign: "right" },
      },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 4) {
          data.cell.styles.textColor = PDF_STATUS_COLORS[GRADE_STATUS[mashGrades[data.row.index].key]];
          data.cell.styles.fontStyle = "bold";
        }
      },
    });
    y = doc.lastAutoTable.finalY + (unreliableLabels.length ? 5 : 10);
    if (unreliableLabels.length) {
      doc.setFontSize(8);
      doc.setTextColor(...PDF_STATUS_COLORS.warn);
      const warnLines = doc.splitTextToSize(
        `(*) Ralentissement du navigateur détecté pendant le test sur: ${unreliableLabels.join(", ")}, mesure peu fiable pour ce(s) bouton(s), à retester.`,
        PDF_CONTENT_WIDTH - 4,
      );
      doc.text(warnLines, PDF_MARGIN + 2, y);
      y += warnLines.length * 4 + 6;
      doc.setTextColor(...PDF_DARK);
    }
    const verdict = buildMashVerdict(report.mashTest);
    doc.setFontSize(9);
    doc.setFont(undefined, "bold");
    doc.setTextColor(...PDF_STATUS_COLORS[verdict.tone]);
    const verdictLines = doc.splitTextToSize(verdict.text, PDF_CONTENT_WIDTH - 4);
    doc.text(verdictLines, PDF_MARGIN + 2, y);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...PDF_DARK);
    y += verdictLines.length * 4.5 + 8;
  } else {
    doc.setFontSize(9.5);
    doc.setTextColor(...PDF_DARK);
    const lines = doc.splitTextToSize(
      "Aucun diagnostic guidé des boutons effectué avant l'export. Lancez ce test depuis l'application pour fiabiliser cette partie du rapport.",
      PDF_CONTENT_WIDTH - 4,
    );
    doc.text(lines, PDF_MARGIN + 2, y);
    y += lines.length * 5 + 6;
  }
  y = pdfDivider(doc, y);

  y = pdfEnsureSpace(doc, y, 28);
  y = pdfPanelHeader(doc, "Limites de ce diagnostic", y, PDF_MUTED);
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_MUTED);
  const limitsLines = doc.splitTextToSize(
    "Ce rapport dépend du navigateur et du système utilisés (fréquence de lecture de la manette, throttling d'un onglet en arrière-plan, pilote...). " +
      "Il donne une bonne indication de l'état de la manette mais ne remplace pas un diagnostic matériel certifié. " +
      "Un résultat isolé sur un seul bouton n'implique pas forcément un défaut, retestez avant de conclure, surtout si le reste du diagnostic est bon.",
    PDF_CONTENT_WIDTH - 4,
  );
  doc.text(limitsLines, PDF_MARGIN + 2, y);

  const totalPages = doc.getNumberOfPages();
  for (let page = 1; page <= totalPages; page++) {
    doc.setPage(page);
    doc.setFontSize(8);
    doc.setFont(undefined, "normal");
    doc.setTextColor(...PDF_MUTED);
    doc.text("Gamepad Tester", PDF_MARGIN, 291);
    doc.text(`Page ${page} / ${totalPages}`, PDF_PAGE_WIDTH - PDF_MARGIN, 291, { align: "right" });
  }

  return doc;
}
