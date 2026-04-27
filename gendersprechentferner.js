// ==UserScript==
// @name         Gendersprechentferner
// @namespace    gendersprechentferner
// @version      1.0.0
// @description  Entfernt Binnen-Is, Gendersterne, Unterstriche, Doppelpunkte, Doppelformen und Partizipkonstruktionen – mit Shadow-DOM- und SPA-Unterstützung
// @match        http://*/*
// @match        https://*/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // =========================================================================
    // Konfiguration
    // =========================================================================
    var CONFIG = {
        entferneBinnenI: true,
        entferneDoppelformen: true,
        entfernePartizip: true,
        ersetzeGefluechtete: true,
        entferneDoppelpunktArtikel: true,
        // Verzögerung nach Mutations, bevor verarbeitet wird (ms)
        debounceMs: 80,
        // Intervall für Shadow-DOM-Scanning (ms) – 0 = aus
        shadowScanInterval: 2000,
        // Maximale Anzahl Shadow-DOM-Scans
        maxShadowScans: 30,
        debug: false
    };

    // =========================================================================
    // Hilfsfunktionen
    // =========================================================================

    function log() {
        if (CONFIG.debug) {
            console.log.apply(console, ["[Neusprech]"].concat(Array.prototype.slice.call(arguments)));
        }
    }

    function createSetLike() {
        if (typeof WeakSet !== "undefined") return new WeakSet();
        return {
            _items: [],
            has: function(o) { return this._items.indexOf(o) > -1; },
            add: function(o) {
                if (this._items.indexOf(o) === -1) this._items.push(o);
            }
        };
    }

    function escapeRegExp(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function capitalize(word) {
        return word ? word.charAt(0).toUpperCase() + word.slice(1) : word;
    }

    function preserveCase(source, replacement) {
        if (!source) return replacement;
        if (source === source.toUpperCase()) return replacement.toUpperCase();
        if (source.charAt(0) === source.charAt(0).toUpperCase()) return capitalize(replacement);
        return replacement;
    }

    function preserveNounCase(source, replacement) {
        if (!source) return capitalize(replacement);
        if (source === source.toUpperCase()) return replacement.toUpperCase();
        return capitalize(replacement);
    }

    function isLikelySingularVerbContext(whole, offset, length) {
        var tail = whole.slice(offset + length, offset + length + 60);
        return /\b(ist|war|wird|bleibt|hat|hätte|kann|könnte|muss|müsste|darf|dürfte|soll|sollte|möchte|kommt|geht)\b/i.test(tail);
    }

    function isHTMLFormattingNodeName(nodeName) {
        if (!nodeName) return false;
        switch (nodeName.toLowerCase()) {
            case "mark": case "b": case "strong": case "i": case "em":
            case "small": case "del": case "ins": case "sub": case "sup":
            case "a": case "span": case "abbr": case "u": case "s":
                return true;
            default:
                return false;
        }
    }

    // Prüfe ob ein Knoten in einem bearbeitbaren/geschützten Element liegt
    function isProtectedNode(node) {
        var parent = node.parentNode;
        if (!parent) return false;
        var tag = parent.nodeName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" ||
            tag === "CODE" || tag === "PRE" || tag === "KBD" ||
            tag === "SAMP" || tag === "VAR" || tag === "TEXTAREA") {
            return true;
        }
        if (parent instanceof HTMLInputElement) return true;
        if (parent.getAttribute && (
            parent.getAttribute("contenteditable") === "true" ||
            parent.getAttribute("role") === "textbox")) {
            return true;
        }
        // Prüfe auch Großeltern (z.B. <code><span>...</span></code>)
        var grandparent = parent.parentNode;
        if (grandparent) {
            var gTag = grandparent.nodeName;
            if (gTag === "CODE" || gTag === "PRE" || gTag === "SCRIPT" || gTag === "STYLE") {
                return true;
            }
        }
        return false;
    }

    var PARTIZIP_NOUNS = [
        { wort: "Studierende", singularMaskulin: "Student", singularFeminin: "Studentin", plural: "Studenten", oblique: "Studenten" },
        { wort: "Teilnehmende", singularMaskulin: "Teilnehmer", singularFeminin: "Teilnehmerin", plural: "Teilnehmer", oblique: "Teilnehmer" },
        { wort: "Dozierende", singularMaskulin: "Dozent", singularFeminin: "Dozentin", plural: "Dozenten", oblique: "Dozenten" },
        { wort: "Lesende", singularMaskulin: "Leser", singularFeminin: "Leserin", plural: "Leser", oblique: "Leser" },
        { wort: "Assistierende", singularMaskulin: "Assistent", singularFeminin: "Assistentin", plural: "Assistenten", oblique: "Assistenten" },
        { wort: "Antragstellende", singularMaskulin: "Antragsteller", singularFeminin: "Antragstellerin", plural: "Antragsteller", oblique: "Antragsteller" },
        { wort: "Beratende", singularMaskulin: "Berater", singularFeminin: "Beraterin", plural: "Berater", oblique: "Berater" },
        { wort: "Bewerbende", singularMaskulin: "Bewerber", singularFeminin: "Bewerberin", plural: "Bewerber", oblique: "Bewerber" },
        { wort: "Besuchende", singularMaskulin: "Besucher", singularFeminin: "Besucherin", plural: "Besucher", oblique: "Besucher" },
        { wort: "Mitarbeitende", singularMaskulin: "Mitarbeiter", singularFeminin: "Mitarbeiterin", plural: "Mitarbeiter", oblique: "Mitarbeiter" },
        { wort: "Konsumierende", singularMaskulin: "Konsument", singularFeminin: "Konsumentin", plural: "Konsumenten", oblique: "Konsumenten" },
        { wort: "Koordinierende", singularMaskulin: "Koordinator", singularFeminin: "Koordinatorin", plural: "Koordinatoren", oblique: "Koordinatoren" },
        { wort: "Forschende", singularMaskulin: "Forscher", singularFeminin: "Forscherin", plural: "Forscher", oblique: "Forscher" },
        { wort: "Interessierte", singularMaskulin: "Interessent", singularFeminin: "Interessentin", plural: "Interessenten", oblique: "Interessenten" },
        { wort: "Lehrende", singularMaskulin: "Lehrer", singularFeminin: "Lehrerin", plural: "Lehrer", oblique: "Lehrer" },
        { wort: "Leitende", singularMaskulin: "Leiter", singularFeminin: "Leiterin", plural: "Leiter", oblique: "Leiter" },
        { wort: "Lernende", singularMaskulin: "Lerner", singularFeminin: "Lernerin", plural: "Lerner", oblique: "Lerner" },
        { wort: "Moderierende", singularMaskulin: "Moderator", singularFeminin: "Moderatorin", plural: "Moderatoren", oblique: "Moderatoren" },
        { wort: "Pflegende", singularMaskulin: "Pfleger", singularFeminin: "Pflegerin", plural: "Pfleger", oblique: "Pfleger" },
        { wort: "Produzierende", singularMaskulin: "Produzent", singularFeminin: "Produzentin", plural: "Produzenten", oblique: "Produzenten" },
        { wort: "Referierende", singularMaskulin: "Referent", singularFeminin: "Referentin", plural: "Referenten", oblique: "Referenten" },
        { wort: "Erziehende", singularMaskulin: "Erzieher", singularFeminin: "Erzieherin", plural: "Erzieher", oblique: "Erzieher" },
        { wort: "Arbeitende", singularMaskulin: "Arbeiter", singularFeminin: "Arbeiterin", plural: "Arbeiter", oblique: "Arbeiter" },
        { wort: "Spielende", singularMaskulin: "Spieler", singularFeminin: "Spielerin", plural: "Spieler", oblique: "Spieler" },
        { wort: "Übersetzende", singularMaskulin: "Übersetzer", singularFeminin: "Übersetzerin", plural: "Übersetzer", oblique: "Übersetzer" },
        { wort: "Fahrende", singularMaskulin: "Fahrer", singularFeminin: "Fahrerin", plural: "Fahrer", oblique: "Fahrer" },
        { wort: "Zuhörende", singularMaskulin: "Zuhörer", singularFeminin: "Zuhörerin", plural: "Zuhörer", oblique: "Zuhörer" },
        { wort: "Programmierende", singularMaskulin: "Programmierer", singularFeminin: "Programmiererin", plural: "Programmierer", oblique: "Programmierer" },
        { wort: "Zuschauende", singularMaskulin: "Zuschauer", singularFeminin: "Zuschauerin", plural: "Zuschauer", oblique: "Zuschauer" }
    ];
    var PARTIZIP_TRIGGER_REGEX = new RegExp(PARTIZIP_NOUNS.map(function(entry) {
        return escapeRegExp(entry.wort);
    }).concat([
        "Nutzende", "Nutzenden", "Benutzende", "Benutzenden",
        "Vorsitzende", "verdienende", "fahrende"
    ]).join("|"), "i");

    // Regex die prüft ob ein Textknoten relevant sein könnte
    var RELEVANCE_REGEX = /\b(und|oder|bzw)|[a-zA-ZäöüßÄÖÜ][\/\*.&_:\(·]-?[a-zA-ZäöüßÄÖÜ]|[a-zäöüß\(_\*:\.·][iI][nN]|:[ernms]\b|:innen?\b|nE\b|r[MS]\b|e[NR]\b|flüch/;

    function isRelevantText(text) {
        return RELEVANCE_REGEX.test(text) || PARTIZIP_TRIGGER_REGEX.test(text);
    }

    // =========================================================================
    // Text-Knoten finden – mit Shadow-DOM-Unterstützung
    // =========================================================================

    function textNodesUnder(root) {
        var result = [];
        var seen = createSetLike();

        function walkNode(node) {
            if (!node) return;

            // Text-Knoten
            if (node.nodeType === 3) {
                if (node.textContent && node.textContent.length >= 3 &&
                    !isProtectedNode(node) && isRelevantText(node.textContent)) {
                    if (!seen.has(node)) {
                        seen.add(node);

                        var parentNodeName = node.parentNode ? node.parentNode.nodeName : "";
                        if (isHTMLFormattingNodeName(parentNodeName)) {
                            var par = node.parentNode;
                            if (par.previousSibling && par.previousSibling.nodeType === 3 && !seen.has(par.previousSibling)) {
                                seen.add(par.previousSibling);
                                result.push(par.previousSibling);
                            }
                            result.push(node);
                            if (par.nextSibling && par.nextSibling.nodeType === 3 && !seen.has(par.nextSibling)) {
                                seen.add(par.nextSibling);
                                result.push(par.nextSibling);
                            }
                        } else {
                            result.push(node);
                        }
                    }
                }
                return;
            }

            // Element-Knoten
            if (node.nodeType === 1) {
                // Shadow DOM betreten
                if (node.shadowRoot) {
                    walkNode(node.shadowRoot);
                }

                // Kinder durchlaufen
                var child = node.firstChild;
                while (child) {
                    walkNode(child);
                    child = child.nextSibling;
                }
            }

            // DocumentFragment (Shadow Root)
            if (node.nodeType === 11) {
                var child = node.firstChild;
                while (child) {
                    walkNode(child);
                    child = child.nextSibling;
                }
            }
        }

        walkNode(root);
        return result;
    }

    // =========================================================================
    // Alle Shadow Roots finden (auch verschachtelte)
    // =========================================================================

    function findAllShadowRoots(root) {
        var roots = [];

        function walk(node) {
            if (!node) return;
            if (node.nodeType === 1) {
                if (node.shadowRoot) {
                    roots.push(node.shadowRoot);
                    walk(node.shadowRoot);
                }
                var child = node.firstChild;
                while (child) {
                    walk(child);
                    child = child.nextSibling;
                }
            }
            if (node.nodeType === 11) {
                var child = node.firstChild;
                while (child) {
                    walk(child);
                    child = child.nextSibling;
                }
            }
        }

        walk(root);
        return roots;
    }

    // =========================================================================
    // Anwendung auf Knoten
    // =========================================================================

    function applyToNodes(nodes, modifyData) {
        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];
            if (!node.data) continue;
            var oldText = node.data;
            var newText;

            var parentNodeName = node.parentNode ? node.parentNode.nodeName.toLowerCase() : "";
            if (isHTMLFormattingNodeName(parentNodeName)) {
                var prevText = (i > 0 && nodes[i-1] && nodes[i-1].data) ? nodes[i-1].data : "";
                var nextText = (i < nodes.length - 1 && nodes[i+1] && nodes[i+1].data) ? nodes[i+1].data : "";
                var oldTextInContext = prevText + "\f" + oldText + "\f" + nextText;
                oldTextInContext = modifyData(oldTextInContext);
                var index1 = oldTextInContext.indexOf("\f");
                var index2 = oldTextInContext.indexOf("\f", index1 + 1);
                var index3 = oldTextInContext.indexOf("\f", index2 + 1);
                if (index1 > -1 && index2 > -1 && index3 === -1) {
                    newText = oldTextInContext.substring(index1 + 1, index2);
                } else {
                    newText = modifyData(oldText);
                }
            } else {
                newText = modifyData(oldText);
            }

            if (node.data !== newText) {
                log("Ersetzung:", JSON.stringify(oldText), "→", JSON.stringify(newText));
                node.data = newText;
            }
        }
    }

    // =========================================================================
    // Doppelpunkt-basierte Artikel, Pronomen und Adjektive auflösen
    // =========================================================================

    function entferneDoppelpunktArtikel(s) {
        if (!/:/.test(s)) return s;

        // --- Possessivpronomen: Dein:e → Dein, Dein:en → Deinen ---
        s = s.replace(/\b([MmDdSs]ein|[Uu]nser|[Ee]uer|[Ii]hr):(e[rnms]?)\b/g, function(match, stem, ending) {
            if (ending === "e") return stem;
            return stem + ending;
        });

        // --- Artikel-Paare: der:die → der ---
        s = s.replace(/\b[Dd](ie:der|er:die)\b/g, function(m) { return m[0] === "D" ? "Der" : "der"; });
        s = s.replace(/\b[Dd](en:die|ie:den)\b/g, function(m) { return m[0] === "D" ? "Den" : "den"; });
        s = s.replace(/\b[Dd](es:der|er:des)\b/g, function(m) { return m[0] === "D" ? "Des" : "des"; });
        s = s.replace(/\b[Dd](em:der|er:dem)\b/g, function(m) { return m[0] === "D" ? "Dem" : "dem"; });
        s = s.replace(/\b[Dd](essen:deren|eren:dessen)\b/g, function(m) { return m[0] === "D" ? "Dessen" : "dessen"; });

        // --- ein:e / eines:einer / einem:einer usw. ---
        s = s.replace(/\b([DMSdms]?[Ee]in(?:e[smr]|en)?):(ein(?:e[smr]|en)?)\b/g, function(match, left, right) {
            return left;
        });
        s = s.replace(/\b([DMSdms]?[Ee]in):(e[rnms]?)\b/g, function(match, stem, ending) {
            if (ending === "e") return stem;
            return stem + ending;
        });

        // --- kein:e / keines:keiner / keinem:keiner usw. ---
        s = s.replace(/\b([Kk]ein(?:e[smr]|en)?):(kein(?:e[smr]|en)?)\b/g, function(match, left, right) {
            return left;
        });
        s = s.replace(/\b([Kk]ein):(e[rnms]?)\b/g, function(match, stem, ending) {
            if (ending === "e") return stem;
            return stem + ending;
        });

        // --- jede:r → jeder ---
        s = s.replace(/\b([Jj]ed)e:([rnms])\b/g, function(match, stem, ending) {
            return stem + "e" + ending;
        });
        s = s.replace(/\b[Jj]ede:[Jj]eder\b/g, function(m) { return m[0] === "J" ? "Jeder" : "jeder"; });

        // --- welche:r → welcher ---
        s = s.replace(/\b([Ww]elch)e:([rnms])\b/g, function(match, stem, ending) {
            return stem + "e" + ending;
        });

        // --- Adjektive: erste:r → erster ---
        // (?=\b|\u00A0|\s) für Wortgrenze inkl. non-breaking space
        s = s.replace(/\b([A-Za-zÄÖÜäöüß]{2,}e):([rnms])(?=\b|\u00A0)/g, function(match, stem, ending) {
            if (/\d/.test(stem)) return match;
            return stem + ending;
        });

        // --- Pronomen: sie:er → er ---
        s = s.replace(/\b[Ss]ie:[Ee]r\b/g, "Er");
        s = s.replace(/\ber:[Ss]ie\b/g, "er");
        s = s.replace(/\b[Ii]hr:[Ss]ein\b/ig, function(m) { return m[0] === m[0].toUpperCase() ? "Sein" : "sein"; });
        s = s.replace(/\b[Ss]ein:[Ii]hr\b/ig, function(m) { return m[0] === "S" ? "Sein" : "sein"; });
        s = s.replace(/\bihre?[rnms]?:seine?[rnms]?\b/ig, function(m) {
            var found = m.match(/ihre?([rnms]?)/i);
            var ending = found ? found[1] : "";
            return "sein" + (ending === "r" ? "er" : ending === "n" ? "en" : ending === "m" ? "em" : ending === "s" ? "es" : ending === "e" ? "e" : "");
        });
        s = s.replace(/\bseine?[rnms]?:ihre?[rnms]?\b/ig, function(m) {
            var found = m.match(/(seine?[rnms]?)/i);
            return found ? found[1] : m;
        });

        // --- Substantive :innen (Plural) ---
        s = s.replace(/([\u00AD\u200B])(?=:in)/g, "");

        if (/:inn?en\b/.test(s)) {
            // Sonderfälle
            s = s.replace(/[Ää]rzt:innen/g, function(m) { return m[0] === "Ä" ? "Ärzte" : "ärzte"; });
            s = s.replace(/[Aa]nwält:innen/g, function(m) { return m[0] === "A" ? "Anwälte" : "anwälte"; });
            s = s.replace(/[Rr]ät:innen/g, function(m) { return m[0] === "R" ? "Räte" : "räte"; });
            s = s.replace(/[Bb]äue?r:innen/g, function(m) { return m[0] === "B" ? "Bauern" : "bauern"; });
            s = s.replace(/[Gg]ött:innen/g, function(m) { return m[0] === "G" ? "Götter" : "götter"; });
            s = s.replace(/[Cc]hef:innen/g, function(m) { return m[0] === "C" ? "Chefs" : "chefs"; });
            s = s.replace(/[Ff]an:innen/g, function(m) { return m[0] === "F" ? "Fans" : "fans"; });

            // Dativ-Kontext: den Lehrer:innen → den Lehrern, den Programmierer:innen → den Programmierern
            s = s.replace(/\b((?:[Dd]en|[Aa]us|[Aa]ußer|[Bb]ei|[Dd]ank|[Gg]egenüber|[Ll]aut|[Mm]it(?:samt)?|[Nn]ach|[Ss]amt|[Vv]on|[Uu]nter|[Zz]u|[Ww]egen|[MmSsDd]?einen)(?:\s+(?:zwei|drei|\d+))?\s+(?:[a-zäöüß]+(?:en)?\s+|[\d.,]+\s+)?(?:[A-ZÄÖÜ][a-zäöüß]+)?)er:innen\b/g, function(m, p1) {
                return p1 + "ern";
            });

            // Standard: Lehrer:innen → Lehrer
            s = s.replace(/([a-zäöüß])er:innen\b/g, function(m, p1) { return p1 + "er"; });
            // Kolleg:innen → Kollegen, Tutor:innen → Tutoren
            s = s.replace(/([a-zäöüß])(?:e)?:innen\b/g, function(m, p1) { return p1 + "en"; });
        }

        // --- Substantive :in (Singular) ---
        if (/:in\b/.test(s) && !/(?:[Pp]lug|Log|[Aa]dd|Linked):?[Ii]n\b/.test(s)) {
            s = s.replace(/[Ää]rzt:in\b/g, function(m) { return m[0] === "Ä" ? "Arzt" : "arzt"; });
            s = s.replace(/[Aa]nwält:in\b/g, function(m) { return m[0] === "A" ? "Anwalt" : "anwalt"; });
            s = s.replace(/[Rr]ät:in\b/g, function(m) { return m[0] === "R" ? "Rat" : "rat"; });
            s = s.replace(/[Bb]äue?r:in\b/g, function(m) { return m[0] === "B" ? "Bauer" : "bauer"; });
            s = s.replace(/\beines [Ee]xpert:in\b/g, function(m) { return /eines expert:in/.test(m) ? "eines experten" : "eines Experten"; });
            s = s.replace(/\beinem [Ee]xpert:in\b/g, function(m) { return /einem expert:in/.test(m) ? "einem experten" : "einem Experten"; });
            s = s.replace(/\bden [Ee]xpert:in\b/g, function(m) { return /den expert:in/.test(m) ? "den experten" : "den Experten"; });
            s = s.replace(/[Ee]xpert:in\b/g, function(m) { return m[0] === "E" ? "Experte" : "experte"; });

            // Standard: Tutor:in → Tutor, Ansprechpartner:in → Ansprechpartner
            s = s.replace(/([a-zäöüß]):in\b(?!(?:\w{1,2}\b)|[A-Z]|[cf]o|te[gr]|act|clu|dex|di[ac]|line|ner|put|sert|stall|stan|stru|val|vent|v?it|voice|nen)/g, function(m, p1) {
                return p1;
            });
        }

        return s;
    }

    // =========================================================================
    // Binnen-I und andere Gender-Trennzeichen (* _ / . ·)
    // =========================================================================

    function entferneBinnenIs(s) {
        // *x entfernen
        if (/\*x/.test(s)) {
            s = s.replace(/([\w\/*]+)\*x\b/ig, function(m, p1) { return p1; });
        }

        // Mittenpunkt (·) normalisieren
        if (/·in/.test(s)) {
            s = s.replace(/·inn(\*|\.|\/)?e(\*|\.|\/)?n/ig, "Innen");
            s = s.replace(/·in\b/ig, "In");
        }

        // Artikel/Pronomen mit Trennzeichen
        if (/[a-zA-ZäöüßÄÖÜ][\/\*.&_\(]-?[a-zA-ZäöüßÄÖÜ]/.test(s) && /der|die|dessen|ein|sie|ihr|sein|zu[rm]|jede|frau|man|eR\b|em?[\/\*.&_\(]-?e?r\b|em?\(e?r\)\b/.test(s)) {
            if (/der|die|dessen|ein|sie|ih[rmn]|zu[rm]|jede/i.test(s)) {
                s = s.replace(/\b(d)(ie[\/\*_\(-]+der|er[\/\*_\(-]+die)\b/ig, function(m, p1) { return p1 + "er"; });
                s = s.replace(/\b(d)(en[\/\*_\(-]+die|ie[\/\*_\(-]+den)\b/ig, function(m, p1) { return p1 + "en"; });
                s = s.replace(/\b(d)(es[\/\*_\(-]+der|er[\/\*_\(-]+des)\b/ig, function(m, p1) { return p1 + "es"; });
                s = s.replace(/\b(d)(er[\/\*_\(-]+dem|em[\/\*_\(-]+der)\b/ig, function(m, p1) { return p1 + "em"; });
                s = s.replace(/\b(d)(eren[\/\*_\(-]dessen|essen[\/\*_\(-]deren)\b/ig, function(m, p1) { return p1 + "essen"; });
                s = s.replace(/\bdiese[r]?[\/\*_\(-](diese[rnms])|(diese[rnms])[\/\*_\(-]diese[r]?\b/ig, function(m, p1, p2) { return p1 || p2; });
                s = s.replace(/\b([DMSdms]?[Ee])in([\/\*_\(-]+e |\(e\) |E )/g, function(m, p1) { return p1 + "in "; });
                s = s.replace(/\b([DMSdms]?[Ee])ine([\/\*_\(-]+r |\(r\) |R )/g, function(m, p1) { return p1 + "iner "; });
                s = s.replace(/\b([DMSdms]?[Ee])iner([\/\*_\(-]+s |\(S\) |S )/g, function(m, p1) { return p1 + "ines "; });
                s = s.replace(/\b([DMSdms]?[Ee])ines([\/\*_\(-]+r |\(R\) |R )/g, function(m, p1) { return p1 + "ines "; });
                s = s.replace(/\b([DMSdms]?[Ee])iner([\/\*_\(-]+m |\(m\) |M )/g, function(m, p1) { return p1 + "inem "; });
                s = s.replace(/\b([DMSdms]?[Ee])inem([\/\*_\(-]+r |\(r\) |R )/g, function(m, p1) { return p1 + "inem "; });
                s = s.replace(/\b([DMSdms]?[Ee])ine([\/\*_\(-]+n |\(n\) |N )/g, function(m, p1) { return p1 + "inen "; });
                s = s.replace(/\bsie[\/\*_\(-]er|er[\/\*_\(-]sie\b/g, "er");
                s = s.replace(/\bSie[\/\*_\(-][Ee]r|Er[\/\*_\(-][Ss]ie\b/g, "Er");
                s = s.replace(/\b(i)(hr[\/\*_\(-]ihm|hm[\/\*_\(-]ihr)\b/ig, function(m, p1) { return p1 + "hm"; });
                s = s.replace(/\bsie[\/\*_\(-]ihn|ihn[\/\*_\(-]ie\b/g, "ihn");
                s = s.replace(/\bSie[\/\*_\(-][Ii]hn|Ihn[\/\*_\(-][Ss]ie\b/g, "Ihn");
                s = s.replace(/\bihr[\/\*_\(-]e\b/ig, "ihr");
                s = s.replace(/\bihre?[rnms]?[\/\*_\(-](seine?[rnms]?)|(seine?[rnms]?)[\/\*_\(-]ihre?[rnms]?\b/ig, function(m, p1, p2) { return p1 || p2; });
                s = s.replace(/\b(z)(um\/zur|ur\/zum)\b/ig, function(m, p1) { return p1 + "um"; });
                s = s.replace(/\jede[rnms]?[\/\*_\(-](jede[rnms]?)\b/ig, function(m, p1) { return p1; });
            }

            if (/eR\b|em?[\/\*_\(-]{1,2}e?r\b|em?\(e?r\)\b/.test(s)) {
                s = s.replace(/e[\/\*_\(-]+r|e\(r\)|eR\b/g, "er");
                s = s.replace(/em\(e?r\)|em[\/\*_\(-]+r\b/g, "em");
                s = s.replace(/er\(e?s\)|es[\/\*_\(-]+r\b/g, "es");
            }

            if (/\/(frau|man|mensch)/.test(s)) {
                s = s.replace(/\b(frau|man+|mensch)+[\/\*_\(-](frau|man+|mensch|[\/\*_\(-])*/, "man");
            }
        }

        // Binnen-I mit Trennzeichen
        if (/[a-zäöüß\u00AD\u200B]{2}((\/-?|_|\*|:|\.| und -)?In|(\/-?|_|\*|:|\.| und -)in(n[\*|\.]en)?|INNen|\([Ii]n+(en\)|\)en)?|\/inne?)(?!(\w{1,2}\b)|[A-Z]|[cf]o|te[gr]|act|clu|dex|di|line|ner|put|sert|stall|stan|stru|val|vent|v?it|voice)|[A-ZÄÖÜß\u00AD\u200B]{3}(\/-?|_|\*|:|\.)IN\b/.test(s)) {
            s = s.replace(/[\u00AD\u200B]/g, "");

            if (/[a-zäöüß](\/-?|_|\*|:|\.| und -)in\b/i.test(s) || /[a-zäöüß](\/-?|_|\*|:|\.| und -)inn(\*|\.|\))?en/i.test(s) || /[a-zäöüß](\(|\/)in/i.test(s) || /[a-zäöüß]INNen/.test(s)) {
                s = s.replace(/(\/-?|_|\*|:|\.|·)inn(\*|\.|\/)?e(\*|\.|\/)?n/ig, "Innen");
                s = s.replace(/([a-zäöüß])\(inn(en\)|\)en)/ig, "$1Innen");
                s = s.replace(/([a-zäöüß])INNen/g, "$1Innen");
                s = s.replace(/ und -innen\b/ig, "");
                s = s.replace(/(\/-?|_|\*|:|\.|·)in\b/ig, "In");
                s = s.replace(/([a-zäöüß])\(in\)/ig, "$1In");
            }

            // Plural
            if (/[a-zäöüß]Innen/i.test(s)) {
                if (/(chef|fan|gött|verbesser|äur|äs)innen/i.test(s)) {
                    s = s.replace(/(C|c)hefInnen/g, function(m, p1) { return p1 + "hefs"; });
                    s = s.replace(/(F|f)anInnen/g, function(m, p1) { return p1 + "ans"; });
                    s = s.replace(/([Gg]ött|verbesser)(?=Innen)/g, function(m, p1) { return p1 + "er"; });
                    s = s.replace(/äue?rInnen/g, "auern");
                    s = s.replace(/äsInnen/g, "asen");
                }
                s = s.replace(/\b(([Dd]en|[Aa]us|[Aa]ußer|[Bb]ei|[Dd]ank|[Gg]egenüber|[Ll]aut|[Mm]it(samt)?|[Nn]ach|[Ss]amt|[Vv]on|[Uu]nter|[Zz]u|[Ww]egen|[MmSsDd]?einen)(?: zwei| drei| [0-9]+)?[\s]{1,2}([ID]?[a-zäöüß]+en[\s]{1,2}|[0-9.,]+[\s]{1,2})?[A-ZÄÖÜ][a-zäöüß]+)erInnen\b/g, function(m, p1) {
                    return p1 + "ern";
                });
                s = s.replace(/(er?|ER?)Innen/g, function(m, p1) { return p1; });
                s = s.replace(/((?:von[\s]{1,2}|mit[\s]{1,2})(?:[A-Z][a-zöüä]+\b[,][\s]{1,2}|[A-Z][*I_ïa-zöüä]+\b und[\s]{1,2})[a-zA-Zöäüß]*?)([Aa]nwält|[Ää]rzt|e[iu]nd|rät|amt|äst|würf|äus|[ai(eu)]r|irt)Innen/g, function(m, p1, p2) {
                    return p1 + p2 + "en";
                });
                s = s.replace(/([Aa]nwält|[Ää]rzt|e[iu]nd|rät|amt|äst|würf|äus|[ai(eu)]r|irt)Innen/g, function(m, p1) {
                    return p1 + "e";
                });
                s = s.replace(/([nrtsmdfghpbklvwNRTSMDFGHPBKLVW])Innen/g, function(m, p1) {
                    return p1 + "en";
                });
            }

            // Singular
            if (/[a-zäöüß]In/.test(s) && !/([Pp]lug|Log|[Aa]dd|Linked)In\b/.test(s)) {
                if (/amtIn|stIn\B|verbesser(?=In)/.test(s)) {
                    s = s.replace(/verbesser(?=In)/g, "verbesserer");
                    s = s.replace(/amtIn/g, "amter");
                    s = s.replace(/stIn\B(?!(\w{1,2}\b)|[A-Z]|[cf]o|te[gr]|act|clu|dex|di[ac]|line|ner|put|sert|stall|stan|stru|val|vent|v?it|voice)/g, "sten");
                }
                if (/[äöüÄÖÜ][a-z]{0,3}In/.test(s)) {
                    s = s.replace(/ä(?=s(t)?In|tIn|ltIn|rztIn)/g, "a");
                    s = s.replace(/ÄrztIn/g, "Arzt");
                    s = s.replace(/ö(?=ttIn|chIn)/g, "o");
                    s = s.replace(/ü(?=rfIn)/g, "u");
                    s = s.replace(/ündIn/g, "und");
                    s = s.replace(/äue?rIn/g, "auer");
                }
                s = s.replace(/\b(([Dd]en|[Aa]us|[Aa]ußer|[Bb]ei|[Dd]ank|[Gg]egenüber|[Ll]aut|[Mm]it(samt)?|[Nn]ach|[Ss]amt|[Uu]nter|[Vv]on|[Zz]u|[Ww]egen|[MmSsDd]?eine[mnrs]) ([ID]?[a-zäöüß]+en)?[A-ZÄÖÜ][a-zäöüß]+)logIn\b/g, function(m, p1) {
                    return p1 + "logen";
                });
                s = s.replace(/([skgvwzSKGVWZ]|ert|[Bb]rit|[Kk]und|ach)In(?!(\w{1,2}\b)|[A-Z]|[cf]o|te[gr]|act|clu|dex|di|line|ner|put|sert|stall|stan|stru|val|vent|v?it|voice)/g, function(m, p1) {
                    return p1 + "e";
                });
                s = s.replace(/([nrtmdbplhfcNRTMDBPLHFC])In(?!(\w{1,2}\b)|[A-Z]|[cf]o|te[gr]|act|clu|dex|di|line|ner|put|sert|stall|stan|stru|val|vent|v?it|voice)/g, function(m, p1) {
                    return p1;
                });
            }
        }

        return s;
    }

    // =========================================================================
    // Doppelformen
    // =========================================================================

    function entferneDoppelformen(s) {
        if (!/\b(und|oder|bzw)|[a-zA-ZäöüßÄÖÜ][\/\*&_\(][a-zA-ZäöüßÄÖÜ]/.test(s)) return s;

        s = s.replace(/(?=\b|[ÄäÖöÜö])((von[\s]{1,2}|für[\s]{1,2}|mit[\s]{1,2})?((d|jed|ein|ihr|zum|sein)(e[rn]?|ie)[\s]{1,2})?([a-zäöüß]{4,20} )?)([a-zäöüß]{2,})innen( und | oder | & | bzw\.? |[\/\*_\(-])\2?((d|jed|ein|ihr|zum|sein)(e[rmns]?|ie)[\s]{1,2})?\6?(\7(e?n?))\b([\f]?)/ig, function(m, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14) {
            return (p1 || "") + p12 + (p14 || "");
        });
        s = s.replace(/\b(von |für |mit |als )?(((zu )?d|jed|ein|ihr|zur|sein)(e|er|ie) )?(([a-zäöüß]{4,20}[enr]) )?([a-zäöüß]{2,})(en?|in)( und | oder | & | bzw\.? |[\/\*_\(-])(\1|vom )?((((zu )?d|jed|ein|ihr|zum|sein)(e[nrms])? )?(\7[nrms]? )?(\8(e?(s|n|r)?)))\b/ig, function(m, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14, p15, p16, p17, p18) {
            if (p1) {
                if (p6 && !p17) return p1 + p13 + p6 + p18;
                return p1 + p12;
            }
            if (p6 && !p17) return p13 + p6 + p18;
            return p12;
        });
        s = s.replace(/\b(von |für |mit |als )?(((zu )?d|jed|ein|ihr|sein)(e|er|ie) |zur )?(([a-zäöüß]{4,20}[enr]) )?([a-zäöüß]{4,20})?(ärztin|anwältin|bäue?rin|rätin|fränkin|schwäbin|schwägerin)( und | oder | & | bzw\.? |[\/\*_\(-])(\1|vom )?((((zu )?d|jed|ein|ihr|zum|sein)(e[nrms])? )?(\7[nrms]? )?(\8(e?(s|n|r)?))(arzt|anwalt|bauer|rat|frank|schwab|schwager)(e(n|s)?)?)\b/ig, function(m, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12) {
            return (p1 || "") + p12;
        });
        s = s.replace(/\b((von |für |mit |als )?(((zu )?d|jed|ein|ihr|zur|sein)(e|er|ie) )?((zur|[a-zäöüß]{4,20}[enr]) ))?([a-zäöüß]{4,20})?((bäue?r|jüd|fränk|schwäb)innen)( und | oder | & | bzw\.? |[\/\*_\(-])(\1|vom )?((((zu )?d|jed|ein|ihr|zum|sein)(e[nrms])? )?(\7[nrms]? )?(\8(e?(s|n|r)?))(bauer|jude|franke|schwabe)([ns])?)\b/ig, function(m, p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12, p13, p14) {
            return (p1 || "") + p14;
        });
        s = s.replace(/\b((von |für |mit |als )?((d|jed|ein|ihr|zum|sein)(e[rnms]?|ie) )?([a-zäöüß]{4,20}[enr] )?([a-zäöüß]{2,})(e?(n|s|r)?))( und | oder | & | bzw\.? |[\/\*_\(-])(\2|von der )?(((von |zu )?d|jed|ein|ihr|zur|sein)(e[rn]?|ie) )?\6?\7(in(nen)?|en?)\b/ig, function(m, p1) { return p1; });
        s = s.replace(/\b((von |für |mit |als )?((d|jed|ein|ihr|sein)(e[rnms]?|ie) |zum )?([a-zäöüß]{4,20}[enr] )?([a-zäöüß]{4,20})?(arzt|anwalt|bauer|rat|frank|schwab|schwager)(e?(s)?))( und | oder | & | bzw\.? |[\/\*_\(-])(\2|von der )?(((von |zu )?d|jed|ein|ihr|sein)(e[rn]?|ie) |zur )?\6?\7(ärzt|anwält|bäue?rin|rät|fränk|schwäb|schwäger)(in(nen)?)\b/ig, function(m, p1) { return p1; });
        s = s.replace(/\b((von |für |mit |als )?((d|jed|ein|ihr|zum|sein)(e[rnms]?|ie) )?([a-zäöüß]{4,20}[enr] )?([a-zäöüß]{4,20})?(bauer|jud|frank|schwab)(e?n)?)( und | oder | & | bzw\.? |[\/\*_\(-])(\2|von der )?(((von |zu )?d|jed|ein|ihr|zur|sein)(e[rn]?|ie) )?\6?\7(bäue?r|jüd|fränk|schwäb)(in(nen)?)\b/ig, function(m, p1) { return p1; });
        s = s.replace(/\b([A-Z][a-zäöüß]{2,})([a-zäöüß]{2,})innen( und | oder | & | bzw\.? )-(\2(e*n)*)\b/g, function(m, p1, p2, p3, p4) { return p1 + p4; });

        return s;
    }

    // =========================================================================
    // Partizipkonstruktionen
    // =========================================================================

    var PARTIZIP_DATIVE_PREPOSITIONS = "mit|bei|nach|von|zu|aus|unter|gegenüber|dank|entsprechend|gemäß|nahe";
    var PARTIZIP_DATIVE_DETERMINERS = "den|allen|vielen|einigen|wenigen|manchen|sämtlichen|beiden|diesen|jenen|solchen|meinen|deinen|seinen|ihren|unseren|euren";
    var PARTIZIP_OPTIONAL_MODIFIERS = "(?:[A-Za-zÄÖÜäöüß-]+\\s+)*";
    var PARTIZIP_PERSON_MODIFIERS = "(?:[A-Za-zÄÖÜäöüß-]+(?:e|en|er|em|es)\\s+){0,3}";
    var PARTIZIP_WORD_CHARS = "A-Za-zÄÖÜäöüß";
    var PARTIZIP_DATIVE_PREPOSITION_REGEX = new RegExp("\\b(?:" + PARTIZIP_DATIVE_PREPOSITIONS + ")\\s+$", "i");

    function getDativePlural(noun) {
        return /(?:n|s)$/.test(noun) ? noun : noun + "n";
    }

    function getGenitiveSingular(rule) {
        if (rule.genitivSingular) return rule.genitivSingular;
        if (rule.oblique && rule.oblique !== rule.singularMaskulin) return rule.oblique;
        return /(?:s|ß|x|z|tz)$/i.test(rule.singularMaskulin) ? rule.singularMaskulin + "es" : rule.singularMaskulin + "s";
    }

    function isLikelyDativePrepositionContext(whole, offset) {
        var head = whole.slice(Math.max(0, offset - 40), offset);
        return PARTIZIP_DATIVE_PREPOSITION_REGEX.test(head);
    }

    function replacePersonPhrase(articleSource, modifiers, wordSource, articleReplacement, nounReplacement) {
        return preserveCase(articleSource, articleReplacement) + " " + (modifiers || "") + preserveNounCase(wordSource, nounReplacement);
    }

    function ersetzePartizipNomen(s, rule) {
        var escaped = escapeRegExp(rule.wort);
        var dativePlural = rule.dativPlural || getDativePlural(rule.plural);
        var genitiveSingular = getGenitiveSingular(rule);
        var adjectiveStem = escapeRegExp(rule.wort.replace(/e$/, ""));

        s = s.replace(new RegExp("\\b([Dd]er)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, "der") + " " + modifiers + preserveCase(word, rule.singularMaskulin);
        });
        s = s.replace(new RegExp("\\b([Ee]ine)\\s+(" + PARTIZIP_PERSON_MODIFIERS + ")?(" + adjectiveStem + ")e\\s+[Pp]erson\\b", "ig"), function(m, article, modifiers, word) {
            return replacePersonPhrase(article, modifiers, word, "ein", rule.singularMaskulin);
        });
        s = s.replace(new RegExp("\\b([Dd]ie)\\s+(" + PARTIZIP_PERSON_MODIFIERS + ")?(" + adjectiveStem + ")e\\s+[Pp]erson\\b", "ig"), function(m, article, modifiers, word) {
            return replacePersonPhrase(article, modifiers, word, "der", rule.singularMaskulin);
        });
        s = s.replace(new RegExp("\\b([Ee]iner)\\s+(" + PARTIZIP_PERSON_MODIFIERS + ")?(" + adjectiveStem + ")en\\s+[Pp]erson\\b", "ig"), function(m, article, modifiers, word, offset, whole) {
            var isDative = isLikelyDativePrepositionContext(whole, offset);
            return replacePersonPhrase(article, modifiers, word, isDative ? "einem" : "eines", isDative ? rule.oblique : genitiveSingular);
        });
        s = s.replace(new RegExp("\\b([Dd]er)\\s+(" + PARTIZIP_PERSON_MODIFIERS + ")?(" + adjectiveStem + ")en\\s+[Pp]erson\\b", "ig"), function(m, article, modifiers, word, offset, whole) {
            var isDative = isLikelyDativePrepositionContext(whole, offset);
            return replacePersonPhrase(article, modifiers, word, isDative ? "dem" : "des", isDative ? rule.oblique : genitiveSingular);
        });
        s = s.replace(new RegExp("\\b([Dd]ie)\\s+(" + PARTIZIP_PERSON_MODIFIERS + ")?(" + adjectiveStem + ")en\\s+[Pp]ersonen\\b", "ig"), function(m, article, modifiers, word) {
            return replacePersonPhrase(article, modifiers, word, "die", rule.plural);
        });
        s = s.replace(new RegExp("\\b([Dd]en)\\s+(" + PARTIZIP_PERSON_MODIFIERS + ")?(" + adjectiveStem + ")en\\s+[Pp]ersonen\\b", "ig"), function(m, article, modifiers, word) {
            return replacePersonPhrase(article, modifiers, word, "den", dativePlural);
        });
        s = s.replace(new RegExp("\\b([Dd]er)\\s+(" + PARTIZIP_PERSON_MODIFIERS + ")?(" + adjectiveStem + ")en\\s+[Pp]ersonen\\b", "ig"), function(m, article, modifiers, word) {
            return replacePersonPhrase(article, modifiers, word, "der", rule.plural);
        });
        s = s.replace(new RegExp("\\b((?:" + PARTIZIP_DATIVE_PREPOSITIONS + ")\\s+" + PARTIZIP_PERSON_MODIFIERS + ")(" + escaped + ")n\\b(?!\\s+[Pp]erson(?:en)?\\b)", "ig"), function(m, prefix, word) {
            return prefix + preserveCase(word, dativePlural);
        });
        s = s.replace(new RegExp("\\b((?:" + PARTIZIP_DATIVE_PREPOSITIONS + ")\\s+(?:" + PARTIZIP_DATIVE_DETERMINERS + ")\\s+" + PARTIZIP_PERSON_MODIFIERS + ")(" + escaped + ")n\\b(?!\\s+[Pp]erson(?:en)?\\b)", "ig"), function(m, prefix, word) {
            return prefix + preserveCase(word, dativePlural);
        });
        s = s.replace(new RegExp("\\b([Dd]es)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")n\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, "des") + " " + modifiers + preserveCase(word, genitiveSingular);
        });
        s = s.replace(new RegExp("\\b([Dd]em|[Dd]en)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")n\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, article.toLowerCase()) + " " + modifiers + preserveCase(word, rule.oblique);
        });
        s = s.replace(new RegExp("\\b([Ee]in)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")r\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, "ein") + " " + modifiers + preserveCase(word, rule.singularMaskulin);
        });
        s = s.replace(new RegExp("\\b([Ee]ine)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, "eine") + " " + modifiers + preserveCase(word, rule.singularFeminin);
        });
        s = s.replace(new RegExp("\\b([Ee]ines)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")n\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, "eines") + " " + modifiers + preserveCase(word, genitiveSingular);
        });
        s = s.replace(new RegExp("\\b([Ee]inem|[Ee]inen)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")n\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, article.toLowerCase()) + " " + modifiers + preserveCase(word, rule.oblique);
        });
        s = s.replace(new RegExp("\\b([Dd]ie)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")\\b", "g"), function(match, article, modifiers, word, offset, whole) {
            var replacement = isLikelySingularVerbContext(whole, offset, match.length) ? rule.singularFeminin : rule.plural;
            return preserveCase(article, "die") + " " + modifiers + preserveCase(word, replacement);
        });
        s = s.replace(new RegExp("\\b([Dd]ie)\\s+(" + PARTIZIP_OPTIONAL_MODIFIERS + ")(" + escaped + ")n\\b", "g"), function(m, article, modifiers, word) {
            return preserveCase(article, "die") + " " + modifiers + preserveCase(word, rule.plural);
        });
        s = s.replace(new RegExp("(^|[^" + PARTIZIP_WORD_CHARS + "])(" + escaped + ")r(?=$|[^" + PARTIZIP_WORD_CHARS + "])", "g"), function(m, prefix, word) {
            return prefix + preserveCase(word, rule.singularMaskulin);
        });
        s = s.replace(new RegExp("(^|[^" + PARTIZIP_WORD_CHARS + "])(" + escaped + ")m(?=$|[^" + PARTIZIP_WORD_CHARS + "])", "g"), function(m, prefix, word) {
            return prefix + preserveCase(word, rule.oblique);
        });
        s = s.replace(new RegExp("(^|[^" + PARTIZIP_WORD_CHARS + "])(" + escaped + ")s(?=$|[^" + PARTIZIP_WORD_CHARS + "])", "g"), function(m, prefix, word) {
            return prefix + preserveCase(word, genitiveSingular);
        });
        s = s.replace(new RegExp("(^|[^" + PARTIZIP_WORD_CHARS + "])(" + escaped + ")n(?=$|[^" + PARTIZIP_WORD_CHARS + "])", "g"), function(m, prefix, word) {
            return prefix + preserveCase(word, rule.plural);
        });
        s = s.replace(new RegExp("(^|[^" + PARTIZIP_WORD_CHARS + "])(" + escaped + ")(?=$|[^" + PARTIZIP_WORD_CHARS + "])", "g"), function(m, prefix, word) {
            return prefix + preserveCase(word, rule.plural);
        });

        return s;
    }

    function entfernePartizip(s) {
        if (!PARTIZIP_TRIGGER_REGEX.test(s) && !/(ier|arbeit|orsch|fahr|verdien|nehm|es|utz|benutz|ehr|ern|fleg|reis|rzieh)end(?:e|en)/i.test(s)) return s;

        for (var i = 0; i < PARTIZIP_NOUNS.length; i++) {
            s = ersetzePartizipNomen(s, PARTIZIP_NOUNS[i]);
        }
        s = s.replace(/([\wäöüÄÖÜ-]+\s)(Nutzenden|Benutzenden)/g, function(m, prefix, word) {
            var base = /^[Bb]/.test(word) ? "Benutzer" : "Nutzer";
            if (/\b(den|dem|seinen|ihren|unseren|euren|meinen|deinen|allen|vielen|einigen|wenigen|manchen|sämtlichen|beiden|vom|mit|bei|nach|von|zu|aus|unter|gegenüber|dank|entsprechend|gemäß|nahe)\s$/i.test(prefix) || /en\s$/i.test(prefix)) {
                return prefix + base + "n";
            }
            return prefix + base;
        });
        s = s.replace(/\bNutzende([r])?\b/g, "Nutzer");
        s = s.replace(/\bNutzenden\b/g, "Nutzer");
        s = s.replace(/\bBenutzende([r])?\b/g, "Benutzer");
        s = s.replace(/\bBenutzenden\b/g, "Benutzer");
        s = s.replace(/([A-Z]+[a-zäöü]+)fahrende([rnms])?\b/g, function(m, p1) { return p1 + "fahrer"; });
        s = s.replace(/([A-Z]+[a-zäöü]+)verdienende([rnms])?\b/g, function(m, p1) { return p1 + "verdiener"; });

        return s;
    }

    // =========================================================================
    // Geflüchtete → Flüchtlinge
    // =========================================================================

    function ersetzeGefluechteteDurchFluechtlinge(s) {
        if (!/flüch/.test(s)) return s;
        s = s.replace(/[\u00AD\u200B]/g, "");
        if (/\bGeflüchtet(e\b|er\b|en\b)[\s]{1,2}[A-Z]/g.test(s)) return s;

        s = s.replace(/\b([Dd])er (Geflüchtete)\b/g, function(m, initial, word) {
            return (initial === "D" ? "Der" : "der") + " " + preserveCase(word, "Flüchtling");
        });
        s = s.replace(/\b([Aa]us[\s]{1,2}|[Aa]ußer[\s]{1,2}|[Bb]ei[\s]{1,2}|[Zz]u[\s]{1,2}|[Ee]ntgegen[\s]{1,2}|[Ee]ntsprechend[\s]{1,2}|[Gg]emäß[\s]{1,2}|[Gg]etreu[\s]{1,2}|[Gg]egenüber[\s]{1,2}|[Nn]ahe[\s]{1,2}|[Mm]it[\s]{1,2}|[Nn]ach[\s]{1,2}|[Ss]amt[\s]{1,2}|[Mm]itsamt[\s]{1,2}|[Ss]eit[\s]{1,2}|[Vv]on[\s]{1,2})?(den[\s]{1,2})?(den[\s]{1,2}|vielen[\s]{1,2}|mehreren[\s]{1,2})?([A-Z][a-zöüä]+\b[,][\s]{1,2}|[A-Z][a-zöüä]+\b und[\s]{1,2})*([„"‟"''❝❞❮❯⹂〝〞〟＂‚'‛❛❜❟«‹»›]?Geflüchtet(e\b|en\b|er\b)[„"‟"''❝❞❮❯⹂〝〞〟＂‚'‛❛❜❟«‹»›]?)([\s]{1,2}zufolge)?\b/g, function(m, praep, den, zahlwort, aufz, gefl, endung, zufolge) {
            praep = praep || ""; zahlwort = zahlwort || ""; aufz = aufz || ""; zufolge = zufolge || ""; den = den || "";
            return praep + den + zahlwort + aufz + ((praep || den) ? "Flüchtlingen" : "Flüchtlinge") + zufolge;
        });
        s = s.replace(/\b(geflüchtet)(e(?:(r|n)?)?[\s]{1,2}(?:Kind|Mensch)[\w]+)\b/g, function(m, g, rest) { return "geflohen" + rest; });
        s = s.replace(/\b(Geflüchteten)([\w]{3,})\b/g, function(m, g, rest) { return "Flüchtlings" + rest; });

        return s;
    }

    // =========================================================================
    // Hauptfunktion
    // =========================================================================

    function entferneAlles(s) {
        if (CONFIG.entferneDoppelpunktArtikel) s = entferneDoppelpunktArtikel(s);
        if (CONFIG.entferneDoppelformen) s = entferneDoppelformen(s);
        if (CONFIG.entfernePartizip) s = entfernePartizip(s);
        if (CONFIG.entferneBinnenI) s = entferneBinnenIs(s);
        if (CONFIG.ersetzeGefluechtete) s = ersetzeGefluechteteDurchFluechtlinge(s);
        return s;
    }

    // =========================================================================
    // Einen Wurzelknoten (document oder shadowRoot) verarbeiten
    // =========================================================================

    function processRoot(root) {
        var nodes = textNodesUnder(root);
        if (nodes.length > 0) {
            log("Verarbeite", nodes.length, "Textknoten in", root === document ? "document" : "shadowRoot");
            applyToNodes(nodes, entferneAlles);
        }
    }

    // =========================================================================
    // MutationObserver einrichten – für einen bestimmten Root
    // =========================================================================

    var observedRoots = createSetLike();

    function observeRoot(root) {
        if (observedRoots.has(root)) return;
        observedRoots.add(root);

        var pendingNodes = [];
        var debounceTimer = null;

        var observer = new MutationObserver(function(mutations) {
            var insertedNodes = [];
            for (var m = 0; m < mutations.length; m++) {
                var mutation = mutations[m];
                if (mutation.type === 'characterData' && mutation.target && mutation.target.data) {
                    insertedNodes.push(mutation.target);
                }
                for (var i = 0; i < mutation.addedNodes.length; i++) {
                    var added = mutation.addedNodes[i];
                    if (added.nodeType === 3) {
                        insertedNodes.push(added);
                    } else if (added.nodeType === 1) {
                        // Prüfe auch auf neue Shadow DOMs
                        if (added.shadowRoot) {
                            processRoot(added.shadowRoot);
                            observeRoot(added.shadowRoot);
                        }
                        var subNodes = textNodesUnder(added);
                        for (var j = 0; j < subNodes.length; j++) {
                            insertedNodes.push(subNodes[j]);
                        }
                    }
                }
            }

            if (insertedNodes.length > 0) {
                for (var k = 0; k < insertedNodes.length; k++) {
                    pendingNodes.push(insertedNodes[k]);
                }

                if (debounceTimer) clearTimeout(debounceTimer);
                debounceTimer = setTimeout(function() {
                    if (pendingNodes.length > 0) {
                        observer.disconnect();

                        // Deduplizieren
                        var unique = [];
                        var seen = createSetLike();
                        for (var i = 0; i < pendingNodes.length; i++) {
                            if (pendingNodes[i].data && !seen.has(pendingNodes[i])) {
                                seen.add(pendingNodes[i]);
                                unique.push(pendingNodes[i]);
                            }
                        }

                        log("MutationObserver: Verarbeite", unique.length, "neue Knoten");
                        applyToNodes(unique, entferneAlles);
                        pendingNodes = [];

                        observer.observe(root, observerConfig);
                    }
                }, CONFIG.debounceMs);
            }
        });

        var observerConfig = {
            childList: true,
            subtree: true,
            attributes: false,
            characterData: true
        };

        observer.observe(root, observerConfig);
        log("Observer eingerichtet für", root === document ? "document" : "shadowRoot");
    }

    // =========================================================================
    // Shadow-DOM-Scanner: Findet periodisch neue Shadow Roots
    // (Notwendig für SPAs/Microfrontends die Shadow DOMs asynchron erzeugen)
    // =========================================================================

    var shadowScanCount = 0;
    var knownShadowRoots = createSetLike();
    var fullRescanTimer = null;
    var historyPatched = false;
    var attachShadowPatched = false;

    function scheduleFullRescan(delayMs) {
        if (fullRescanTimer) clearTimeout(fullRescanTimer);
        fullRescanTimer = setTimeout(function() {
            fullRescanTimer = null;
            processRoot(document);
            shadowScanCount = 0;
            scanForShadowRoots();
        }, delayMs || 0);
    }

    function registerShadowRoot(root) {
        if (!root || knownShadowRoots.has(root)) return;
        knownShadowRoots.add(root);
        processRoot(root);
        observeRoot(root);
    }

    function installNavigationHooks() {
        if (historyPatched || !window.history) return;
        historyPatched = true;

        function wrapHistoryMethod(name) {
            if (typeof window.history[name] !== "function") return;
            var original = window.history[name];
            window.history[name] = function() {
                var result = original.apply(this, arguments);
                scheduleFullRescan(300);
                return result;
            };
        }

        wrapHistoryMethod("pushState");
        wrapHistoryMethod("replaceState");
        window.addEventListener("popstate", function() { scheduleFullRescan(150); });
        window.addEventListener("hashchange", function() { scheduleFullRescan(100); });
    }

    function installAttachShadowHook() {
        if (attachShadowPatched || typeof Element === "undefined" || !Element.prototype.attachShadow) return;
        attachShadowPatched = true;

        var original = Element.prototype.attachShadow;
        Element.prototype.attachShadow = function() {
            var root = original.apply(this, arguments);
            setTimeout(function() {
                registerShadowRoot(root);
            }, 0);
            return root;
        };
    }

    function scanForShadowRoots() {
        var allElements = document.querySelectorAll('*');
        var newRootsFound = 0;

        for (var i = 0; i < allElements.length; i++) {
            var el = allElements[i];
            if (el.shadowRoot && !knownShadowRoots.has(el.shadowRoot)) {
                newRootsFound++;
                log("Neue Shadow Root gefunden:", el.nodeName, el.className || el.id || "");
                registerShadowRoot(el.shadowRoot);

                // Verschachtelte Shadow Roots
                var nested = findAllShadowRoots(el.shadowRoot);
                for (var j = 0; j < nested.length; j++) {
                    if (!knownShadowRoots.has(nested[j])) {
                        newRootsFound++;
                        registerShadowRoot(nested[j]);
                    }
                }
            }
        }

        if (newRootsFound > 0) {
            log("Shadow-Scan #" + shadowScanCount + ": " + newRootsFound + " neue Shadow Roots gefunden");
        }

        shadowScanCount++;
        if (CONFIG.shadowScanInterval > 0 && shadowScanCount < CONFIG.maxShadowScans) {
            setTimeout(scanForShadowRoots, CONFIG.shadowScanInterval);
        } else if (shadowScanCount >= CONFIG.maxShadowScans) {
            log("Shadow-Scan beendet (Maximum erreicht)");
        }
    }

    // =========================================================================
    // Initialisierung
    // =========================================================================

    function init() {
        log("Initialisierung...");

        installAttachShadowHook();
        installNavigationHooks();

        // 1. Document verarbeiten
        processRoot(document);
        observeRoot(document);

        // 2. Sofort nach Shadow Roots suchen
        scanForShadowRoots();

        log("Neusprech-Entferner v1.0.0 geladen.");
    }

    // Starte mit kurzer Verzögerung um sicherzustellen, dass SPA-Frameworks geladen sind
    if (document.readyState === 'complete') {
        setTimeout(init, 300);
    } else {
        window.addEventListener('load', function() {
            setTimeout(init, 300);
        });
    }

})();
