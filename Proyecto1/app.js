function escapeHtml(s){
  if (s == null || s == undefined) return "";
  return String(s)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");
}

/* ============================
   Tipos de token y conjunto de palabras reservadas
   ============================ */

const TokenType ={
  RESERVED: "RESERVED",
  IDENT: "IDENT",
  STRING:"STRING",
  NUMBER:"NUMBER",
  VS: "VS",
  LBRACE: "LBRACE", RBRACE: "RBRACE",
  LBRACKET: "LBRACKET", RBRACKET: "RBRACKET",
  COLON: "COLON", COMMA: "COMMA", SEMICOLON: "SEMICOLON",
};

// Normalizar el conjunto de reservadas a minúsculas

const RESERVED_SET = new Set([
  "torneo", "equipos", "eliminacion", 
  "equipo", "jugador", "partido", "resultado", "goleadores",
  "cuartos", "semifinal", "final", "nombre", "posicion", "numero",
  "edad", "vs", "goleador", "minuto", "sede"

]);

/* ============================
   Scanner (AFD manual)
   Entrada: texto -> Salida: {tokens, errors}
   Cada token: {type, lexeme, line, col}
   Cada error: {lexema, tipo, descripcion, line, col}
   ============================ */

function scan(text){
  const tokens = [];
  const errors =[];
  let i = 0, line = 1, col = 0;

  function current (){ return text[i]; }
  function lookahead(k=1){ return text[i+k] || null; }
  function advance(){
    const ch = text[i++];
    if(ch === '\n'){ line++; col = 0; } else { col++; }
    return ch;
  }

  function addToken(type, lexeme, l, c){tokens.push({type, lexeme, line:l, col:c});}
  function addError(lexeme, tipo, desc, l, c){ errors.push({lexema:lexeme,tipo,descripcion:desc,line:l,col:c}); }

  //Funciones para reemplazar expresiones regulares
    function isWhitespace(ch){
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f' || ch === '\v';
  }
     function isDigit(ch){
    return ch >= '0' && ch <= '9';
  }

    function isLetter(ch){
    if(!ch) return false;
    const code = ch.charCodeAt(0);
    return (code >= 65 && code <= 90) || // A-Z
           (code >= 97 && code <= 122) || // a-z
           ch === '_' ||
           ch === 'Á' || ch === 'É' || ch === 'Í' || ch === 'Ó' || ch === 'Ú' ||
           ch === 'á' || ch === 'é' || ch === 'í' || ch === 'ó' || ch === 'ú' ||
           ch === 'Ñ' || ch === 'ñ';
  }

    function isAlphanumeric(ch){
    return isLetter(ch) || isDigit(ch);
  }

  while(i < text.length){
    let ch = current();
    const startLine = line, startCol = col + 1;

    if(isWhitespace(ch)){ advance(); continue; }

    if(ch === '/' && lookahead() === '/'){
      // consumir hasta nueva línea
      advance(); advance();
      while(i < text.length && current() !== '\n') advance();
      continue;
    }
    if(ch === '/' && lookahead() === '*'){
      advance(); advance();
      let closed = false;
      while(i < text.length){
        if(current() === '*' && lookahead() === '/'){ advance(); advance(); closed = true; break; }
        advance();
      }
      if(!closed) addError("/*", "Comentario no cerrado", "Comentario de bloque sin cerrar '*/'", startLine, startCol);
      continue;
    }

    // string "..."
    if(ch === '"'){
      advance(); // consumir "
      let lex = "";
      let closed = false;
      while(i < text.length){
        const c = current();
        if(c === '"'){ advance(); closed = true; break; }
        if(c === '\n'){ addError(lex, "Cadena no cerrada", "Cadena sin comillas de cierre en la misma línea", startLine, startCol); break; }
        lex += advance();
      }
      if(closed) addToken(TokenType.STRING, lex, startLine, startCol);
      continue;
    }

    // número (enteros)
    if(isDigit(ch)){
      let lex = "";
      while(i < text.length && isDigit(current())) lex += advance();
      addToken(TokenType.NUMBER, lex, startLine, startCol);
      continue;
    }

    // identificadores / palabras reservadas (soporta ñ y acentos)
    if(isLetter(ch)){
      let lex = "";
      while(i < text.length && isAlphanumeric(current())) lex += advance();
      const llex = lex.toLowerCase();
      if(llex === 'vs') addToken(TokenType.VS, lex, startLine, startCol); // Mantener el lexema original para VS (los nombres de los equipos permanecen sin cambios)
      else if(RESERVED_SET.has(llex)) addToken(TokenType.RESERVED, llex, startLine, startCol); // tokens reservados almacenados en minúsculas
      else addToken(TokenType.IDENT, lex, startLine, startCol); // Los identificadores mantienen la mayúscula y minúscula originales.
      continue;
    }

    // símbolos simples
    const symMap = {'{':TokenType.LBRACE,'}':TokenType.RBRACE,'[':TokenType.LBRACKET,']':TokenType.RBRACKET,':':TokenType.COLON,',':TokenType.COMMA,';':TokenType.SEMICOLON};
    if(symMap[ch]){
      advance();
      addToken(symMap[ch], ch, startLine, startCol);
      continue;
    }

    // símbolo desconocido -> error
    const bad = advance();
    addError(bad, "Token inválido", `Carácter no reconocido '${bad}'`, startLine, startCol);
  }

  return {tokens, errors};
}

/* ============================
    modelo builder
   - Construye la estructura de torneo a partir de tokens
   - Modelo resultante:
     modelo = { torneo: {...}, equipos: [{nombre, jugadores:[{nombre, ...}]}], eliminacion: {cuartos:[partido], semifinal:[...], final:[...] } }
   - Devuelve {modelo, errores}
   ============================ */

  function buildModel(tokens){
   let idx = 0;
  function peek(){ return tokens[idx] || null; }
  function next(){ return tokens[idx++] || null; }
  function expect(type){ return peek() && peek().type === type ? next() : null; }

  const model = {torneo: null, equipos: [], eliminacion: {}};
  const errors = [];

  // utilidad para obtener un lexema de manera segura.
  function lexOf(t){ return t ? t.lexeme : null; }

  while(peek()){
    const t = peek();

    // TORNEO { ... }
    if(t.type === TokenType.RESERVED && t.lexeme === "torneo"){
      next(); // consume TORNEO
      if(!expect(TokenType.LBRACE)) { errors.push({lexema:"TORNEO", tipo:"Sintaxis", descripcion:"Se esperaba '{' después de TORNEO", line:t.line, col:t.col}); continue; }
      const obj = {};
      while(peek() && peek().type !== TokenType.RBRACE){
        const keyTok = next();
        if(!keyTok) break;
        if((keyTok.type === TokenType.RESERVED) || (keyTok.type === TokenType.IDENT)){
          // keyTok.lexeme ya es minúscula si es RESERVED o conserva el identificador original
          const key = keyTok.lexeme;
          if(!expect(TokenType.COLON)){
            errors.push({lexema:key, tipo:"Sintaxis", descripcion:`Falta ':' después de ${key}`, line:keyTok.line, col:keyTok.col});
          }
          const valTok = peek();
          if(valTok && (valTok.type === TokenType.STRING || valTok.type === TokenType.NUMBER || valTok.type === TokenType.IDENT)){
            obj[key] = next().lexeme;
            // Permitir coma final opcional
            if(peek() && peek().type === TokenType.COMMA) next();
            continue;
          } else {
            errors.push({lexema:key, tipo:"Sintaxis", descripcion:`Valor inválido o faltante para ${key}`, line:keyTok.line, col:keyTok.col});
            if(peek()) next();
            continue;
          }
        } else {
          next();
        }
      }
      if(peek() && peek().type === TokenType.RBRACE) next();
      // Permitir punto y coma después de bloque
      if(peek() && peek().type === TokenType.SEMICOLON) next();
      model.torneo = obj;
      continue;
    }

    // EQUIPOS { ... }
    if(t.type === TokenType.RESERVED && t.lexeme === "equipos"){
      next(); // consumir EQUIPOS
      if(!expect(TokenType.LBRACE)) { errors.push({lexema:"EQUIPOS", tipo:"Sintaxis", descripcion:"Se esperaba '{' después de EQUIPOS", line:t.line, col:t.col}); continue; }
      while(peek() && peek().type !== TokenType.RBRACE){
        const p = peek();
        if(p.type === TokenType.RESERVED && p.lexeme === "equipo"){
          next(); // consume 'equipo'
          if(!expect(TokenType.COLON)) errors.push({lexema:"equipo", tipo:"Sintaxis", descripcion:"Falta ':' después de 'equipo'", line:p.line, col:p.col});
          const nameTok = expect(TokenType.STRING) || expect(TokenType.IDENT);
          const team = {nombre: nameTok ? nameTok.lexeme : "?", jugadores: []};
          // optional players list [ ... ]
          if(peek() && peek().type === TokenType.LBRACKET){
            next(); // consume '['
            while(peek() && peek().type !== TokenType.RBRACKET){
              const j = peek();
              if(j.type === TokenType.RESERVED && j.lexeme === "jugador"){
                next(); // consume 'jugador'
                if(!expect(TokenType.COLON)) errors.push({lexema:"jugador", tipo:"Sintaxis", descripcion:"Falta ':' después de 'jugador'", line:j.line, col:j.col});
                const pname = expect(TokenType.STRING) || expect(TokenType.IDENT);
                const player = {nombre: pname ? pname.lexeme : "?"};
                // atributos de jugador opcionales en el corchete interno
                if(peek() && peek().type === TokenType.LBRACKET){
                  next(); // consume inner '['
                  while(peek() && peek().type !== TokenType.RBRACKET){
                    const attr = peek();
                    if((attr.type === TokenType.RESERVED) || (attr.type === TokenType.IDENT)){
                      const key = next().lexeme;
                      if(!expect(TokenType.COLON)) errors.push({lexema:key, tipo:"Sintaxis", descripcion:`Falta ':' después de ${key}`, line:attr.line, col:attr.col});
                      const v = next();
                      if(v && (v.type === TokenType.STRING || v.type === TokenType.NUMBER || v.type === TokenType.IDENT)){
                        player[key] = v.lexeme;
                      } else {
                        errors.push({lexema:key, tipo:"Sintaxis", descripcion:`Valor inválido para ${key}`, line:attr.line, col:attr.col});
                      }
                      // Permitir coma final opcional
                      if(peek() && peek().type === TokenType.COMMA) next();
                      continue;
                    } else {
                      next();
                    }
                  }
                  if(peek() && peek().type === TokenType.RBRACKET) next();
                }
                team.jugadores.push(player);
                // Permitir coma final opcional
                if(peek() && peek().type === TokenType.COMMA) next();
                continue;
              }
              next();
            } // end players
            if(peek() && peek().type === TokenType.RBRACKET) next();
          } // end optional players
          model.equipos.push(team);
          // Permitir coma final opcional
          if(peek() && peek().type === TokenType.COMMA) next();
          continue;
        }
        next();
      } // end EQUIPOS
      if(peek() && peek().type === TokenType.RBRACE) next();
      // Permitir punto y coma después de bloque
      if(peek() && peek().type === TokenType.SEMICOLON) next();
      continue;
    }

    // ELIMINACION { ... }
    if(t.type === TokenType.RESERVED && t.lexeme === "eliminacion"){
      next(); // consume ELIMINACION
      if(!expect(TokenType.LBRACE)) { errors.push({lexema:"ELIMINACION", tipo:"Sintaxis", descripcion:"Se esperaba '{' después de ELIMINACION", line:t.line, col:t.col}); continue; }
      while(peek() && peek().type !== TokenType.RBRACE){
        const phaseTok = peek();
        if(phaseTok.type === TokenType.RESERVED && (phaseTok.lexeme === "cuartos" || phaseTok.lexeme === "semifinal" || phaseTok.lexeme === "final")){
          const phaseName = next().lexeme; // consume phase
          if(!expect(TokenType.COLON)) errors.push({lexema:phaseName, tipo:"Sintaxis", descripcion:"Falta ':' después de fase", line:phaseTok.line, col:phaseTok.col});
          // permitir contenedor [ ... ] or { ... }
          if(peek() && (peek().type === TokenType.LBRACKET || peek().type === TokenType.LBRACE)) next();
          const partidos = [];
          while(peek() && peek().type !== TokenType.RBRACKET && peek().type !== TokenType.RBRACE){
            const pTok = peek();
            if(pTok.type === TokenType.RESERVED && pTok.lexeme === "partido"){
              next(); // consume 'partido'
              if(!expect(TokenType.COLON)) errors.push({lexema:"partido", tipo:"Sintaxis", descripcion:"Falta ':' después de 'partido'", line:pTok.line, col:pTok.col});
              const t1 = expect(TokenType.STRING) || expect(TokenType.IDENT);
              if(peek() && peek().type === TokenType.VS) next(); // optional vs token
              const t2 = expect(TokenType.STRING) || expect(TokenType.IDENT);
              const partido = {equipoA: t1 ? t1.lexeme : "?", equipoB: t2 ? t2.lexeme : "?", resultado: null, goleadores: []};
              // atributos opcionales entre paréntesis
              if(peek() && peek().type === TokenType.LBRACKET){
                next(); // consume '['
                while(peek() && peek().type !== TokenType.RBRACKET){
                  const attrTok = peek();
                  if((attrTok.type === TokenType.RESERVED) || (attrTok.type === TokenType.IDENT)){
                    const attrName = next().lexeme;
                    if(!expect(TokenType.COLON)) errors.push({lexema:attrName, tipo:"Sintaxis", descripcion:`Falta ':' después de ${attrName}`, line:attrTok.line, col:attrTok.col});
                    // resultado
                    if(attrName === "resultado"){
                      const r = expect(TokenType.STRING) || expect(TokenType.IDENT) || expect(TokenType.NUMBER);
                      if(r) partido.resultado = r.lexeme;
                    }
                    // goleadores: puede ser lista de goleador: "Nombre" [minuto: X]
                    else if(attrName === "goleadores"){
                      if(peek() && peek().type === TokenType.LBRACKET){
                        next(); // consume inner '['
                        while(peek() && peek().type !== TokenType.RBRACKET){
                          // goleador: "Nombre" [minuto: X]
                          if(peek() && peek().type === TokenType.RESERVED && peek().lexeme === "goleador"){
                            next(); // consume goleador
                            if(!expect(TokenType.COLON)) errors.push({lexema:"goleador", tipo:"Sintaxis", descripcion:"Falta ':' después de 'goleador'", line:attrTok.line, col:attrTok.col});
                            const gname = expect(TokenType.STRING) || expect(TokenType.IDENT);
                            const goleadorObj = {jugador: gname ? gname.lexeme : "?", minuto: null};
                            // atributos de goleador
                            if(peek() && peek().type === TokenType.LBRACKET){
                              next(); // consume '['
                              while(peek() && peek().type !== TokenType.RBRACKET){
                                const gattr = peek();
                                if((gattr.type === TokenType.RESERVED) || (gattr.type === TokenType.IDENT)){
                                  const gkey = next().lexeme;
                                  if(!expect(TokenType.COLON)) errors.push({lexema:gkey, tipo:"Sintaxis", descripcion:`Falta ':' después de ${gkey}`, line:gattr.line, col:gattr.col});
                                  const gval = next();
                                  if(gval && (gval.type === TokenType.STRING || gval.type === TokenType.NUMBER || gval.type === TokenType.IDENT)){
                                    goleadorObj[gkey] = gval.lexeme;
                                  }
                                  // Permitir coma final opcional
                                  if(peek() && peek().type === TokenType.COMMA) next();
                                  continue;
                                }
                                next();
                              }
                              if(peek() && peek().type === TokenType.RBRACKET) next();
                            }
                            partido.goleadores.push(goleadorObj);
                            // Permitir coma final opcional
                            if(peek() && peek().type === TokenType.COMMA) next();
                            continue;
                          } else {
                            // modo antiguo: solo nombre (IDENT o STRING)
                            const g = expect(TokenType.STRING) || expect(TokenType.IDENT);
                            if(g) partido.goleadores.push({jugador: g.lexeme});
                            if(peek() && peek().type === TokenType.COMMA) next();
                          }
                        }
                        if(peek() && peek().type === TokenType.RBRACKET) next();
                      } else {
                        // modo antiguo: solo nombre
                        const g = expect(TokenType.STRING) || expect(TokenType.IDENT);
                        if(g) partido.goleadores.push({jugador: g.lexeme});
                      }
                    } else {
                      // atributo desconocido: consumir un valor si está presente
                      if(peek() && (peek().type === TokenType.STRING || peek().type === TokenType.NUMBER || peek().type === TokenType.IDENT)) next();
                    }
                    // Permitir coma final opcional
                    if(peek() && peek().type === TokenType.COMMA) next();
                    continue;
                  }
                  next();
                }
                if(peek() && peek().type === TokenType.RBRACKET) next();
              } // end partido attrs
              partidos.push(partido);
              // Permitir coma final opcional
              if(peek() && peek().type === TokenType.COMMA) next();
              continue;
            }
            next();
          } // end partidos loop
          model.eliminacion[phaseName] = partidos;
          if(peek() && (peek().type === TokenType.RBRACE || peek().type === TokenType.RBRACKET)) next();
          // Permitir coma final opcional
          if(peek() && peek().type === TokenType.COMMA) next();
          continue;
        }
        next();
      } // end ELIMINACION
      if(peek() && peek().type === TokenType.RBRACE) next();
      // Permitir punto y coma después de bloque
      if(peek() && peek().type === TokenType.SEMICOLON) next();
      continue;
    }

    // si no coincide nada, avanzar
    next();
  } // end while

  return {model, errors};
  }

  /* ============================
   Helper function para parsear resultado sin regex
   ============================ */
function parseScore(resultado){
  if(!resultado || typeof resultado !== 'string') return null;
  const trimmed = resultado.trim();
  
  // Buscar patrón número-número manualmente
  let firstNum = "";
  let secondNum = "";
  let i = 0;
  
  // Saltar espacios iniciales
  while(i < trimmed.length && (trimmed[i] === ' ' || trimmed[i] === '\t')) i++;
  
  // Leer primer número
  while(i < trimmed.length && trimmed[i] >= '0' && trimmed[i] <= '9'){
    firstNum += trimmed[i];
    i++;
  }
  
  if(firstNum === "") return null;
  
  // Saltar espacios y buscar guión
  while(i < trimmed.length && (trimmed[i] === ' ' || trimmed[i] === '\t')) i++;
  
  if(i >= trimmed.length || trimmed[i] !== '-') return null;
  i++; // saltar el guión
  
  // Saltar espacios después del guión
  while(i < trimmed.length && (trimmed[i] === ' ' || trimmed[i] === '\t')) i++;
  
  // Leer segundo número
  while(i < trimmed.length && trimmed[i] >= '0' && trimmed[i] <= '9'){
    secondNum += trimmed[i];
    i++;
  }
  
  if(secondNum === "") return null;
  
  // Verificar que no haya más caracteres (solo espacios al final)
  while(i < trimmed.length && (trimmed[i] === ' ' || trimmed[i] === '\t')) i++;
  
  if(i < trimmed.length) return null; // hay caracteres extra
  
  return {
    a: parseInt(firstNum, 10),
    b: parseInt(secondNum, 10)
  };
}

/* ============================
   computeStats(model)
   - Devuelve {standings: [...], scorers: [...]}
   ============================ */
function computeStats(model){
  const teams = {};
  const scorers = {};

  // initialize from equipos list
  if(model.equipos && Array.isArray(model.equipos)){
    model.equipos.forEach(t => {
      teams[t.nombre] = {
        nombre: t.nombre,
        partidos: 0, ganados: 0, empates: 0, perdidos: 0,
        golesFavor: 0, golesContra: 0, diferencia: 0, puntos: 0,
        // faseVal usado internamente para ranking de fase alcanzada (0=no participa)
        faseVal: 0,
        faseAlcanzada: ''
      };
    });
  }

  function ensureTeam(name){
    if(!teams[name]) teams[name] = {nombre: name, partidos:0, ganados:0, empates:0, perdidos:0, golesFavor:0, golesContra:0, diferencia:0, puntos:0, faseVal:0, faseAlcanzada: ''};
  }

  // determinar fase alcanzada por equipo (prioridad final > semifinal > cuartos)
  const phaseOrder = { 'cuartos': 1, 'semifinal': 2, 'final': 3 };
  if(model.eliminacion){
    Object.entries(model.eliminacion).forEach(([phase, matches]) => {
      const pval = phaseOrder[String(phase).toLowerCase()] || 0;
      (matches||[]).forEach(m => {
        ensureTeam(m.equipoA); ensureTeam(m.equipoB);
        teams[m.equipoA].faseVal = Math.max(teams[m.equipoA].faseVal || 0, pval);
        teams[m.equipoB].faseVal = Math.max(teams[m.equipoB].faseVal || 0, pval);
      });
    });
  }

  // (estadísticas y goleadores)
  if(model.eliminacion){
    Object.values(model.eliminacion).forEach(fase => {
      fase.forEach(p => {
        const a = p.equipoA, b = p.equipoB;
        ensureTeam(a); ensureTeam(b);
        if(p.resultado && typeof p.resultado === 'string'){
          const parsed = parseScore(p.resultado);
          if(parsed){
            const x = parsed.a, y = parsed.b;
            teams[a].partidos++; teams[b].partidos++;
            teams[a].golesFavor += x; teams[a].golesContra += y;
            teams[b].golesFavor += y; teams[b].golesContra += x;
            if(x > y){ teams[a].ganados++; teams[b].perdidos++; teams[a].puntos += 3; }
            else if(y > x){ teams[b].ganados++; teams[a].perdidos++; teams[b].puntos += 3; }
            else { teams[a].empates++; teams[b].empates++; teams[a].puntos += 1; teams[b].puntos += 1; }
          }
        }
        // goleadores
        if(p.goleadores && Array.isArray(p.goleadores)){
          p.goleadores.forEach(g => {
            // g puede ser {jugador, minuto} o {jugador} (o por compatibilidad, si existiera un string)
            const name = (typeof g === "string") ? g : (g && g.jugador) ? g.jugador : null;
            if(!name) return;
            if(!scorers[name]) scorers[name] = {jugador: name, goles: 0};
            scorers[name].goles++;
          });
        }
      });
    });
  }

  // convertir faseVal a etiqueta legible
  Object.values(teams).forEach(t => {
    t.diferencia = t.golesFavor - t.golesContra;
    const v = t.faseVal || 0;
    t.faseAlcanzada = v === 3 ? 'Final' : v === 2 ? 'Semifinal' : v === 1 ? 'Cuartos' : '';
  });

  const standings = Object.values(teams).sort((A,B) => {
    if(B.puntos !== A.puntos) return B.puntos - A.puntos;
    if(B.diferencia !== A.diferencia) return B.diferencia - A.diferencia;
    return B.golesFavor - A.golesFavor;
  });

  const scorersList = Object.values(scorers).sort((a,b) => b.goles - a.goles);

  return {standings, scorers: scorersList};
}

/* ============================
   generateDOT(model) - Graphviz DOT
   ============================ */
function generateDOT(model){
  let dot = 'digraph Bracket {\n  rankdir=LR;\n  node [shape=box, style="rounded,filled", fillcolor="#ffffff10", color="#e6eef6"];\n';
  for(const [phase, partidos] of Object.entries(model.eliminacion || {})){
    partidos.forEach((p, idx) => {
      const matchId = `match_${phase}_${idx}`;
      const aId = `node_${phase}_${idx}_A`;
      const bId = `node_${phase}_${idx}_B`;
      // normalizar y extraer resultado con tolerancia a espacios: "3-1", "3 - 1", etc.
      const res = (p.resultado || "").trim();
      const parsed = parseScore(res);
      const aGoals = parsed ? String(parsed.a) : "";
      const bGoals = parsed ? String(parsed.b) : "";
      const labelA = aGoals ? `${p.equipoA} (${aGoals})` : `${p.equipoA}`;
      const labelB = bGoals ? `${p.equipoB} (${bGoals})` : `${p.equipoB}`;
      dot += `  ${aId} [label=${JSON.stringify(labelA)}];\n  ${bId} [label=${JSON.stringify(labelB)}];\n`;
      dot += `  ${aId} -> ${matchId} [arrowhead=none];\n  ${bId} -> ${matchId} [arrowhead=none];\n`;
      dot += `  ${matchId} [label=${JSON.stringify(phase)}, shape=oval, style=filled, fillcolor="#06b6d420", color="#06b6d4"];\n`;
    });
  }
  dot += '}\n';
  return dot;
}

/* ============================
   Reportes visuales (HTML)
   - renderBracketReport
   - renderTeamStats
   - renderGeneralInfo
   ============================ */
function renderBracketReport(model){
  if(!model.eliminacion) return '<p>No hay datos de eliminación registrados.</p>';
  let html = '';
  for(const [fase, partidos] of Object.entries(model.eliminacion)){
    html += `<h3>${fase.toUpperCase()}</h3>`;
    html += `<table class="report-table"><thead><tr><th>Fase</th><th>Partido</th><th>Resultado</th><th>Ganador</th><th>Goleadores</th><th>Estado</th></tr></thead><tbody>`;
    partidos.forEach(p => {
      const estado = (!p.resultado || p.resultado === '-' || p.resultado.trim() === '') ? '<span class="status-pending">Pendiente</span>' : '<span class="status-final">Finalizado</span>';
      // determinar ganador si hay resultado numérico
      let ganador = '-';
      if(p.resultado && typeof p.resultado === 'string'){
        const parsed = parseScore(p.resultado);
        if(parsed){
          const a = parsed.a, b = parsed.b;
          if(a > b) ganador = escapeHtml(p.equipoA);
          else if(b > a) ganador = escapeHtml(p.equipoB);
          else ganador = 'Empate';
        }
      }
      // Mostrar goleadores con minuto si está presente
      let goleadoresHtml = '-';
      if(p.goleadores && p.goleadores.length > 0){
        goleadoresHtml = p.goleadores.map(g => {
          if(typeof g === "string") return escapeHtml(g);
          if(g.minuto) return `${escapeHtml(g.jugador)} <span style="color:#06b6d4;">(${escapeHtml(String(g.minuto))}')</span>`;
          return escapeHtml(g.jugador);
        }).join(', ');
      }
      html += `<tr>
        <td>${escapeHtml(fase)}</td>
        <td>${escapeHtml(p.equipoA)} vs ${escapeHtml(p.equipoB)}</td>
        <td>${escapeHtml(p.resultado || '-')}</td>
        <td>${ganador}</td>
        <td>${goleadoresHtml}</td>
        <td>${estado}</td>
      </tr>`;
    });
    html += `</tbody></table>`;
  }
  return html;
}

function renderTeamStats(stats){
  if(!stats || !stats.standings || stats.standings.length === 0) return '<p>No hay estadísticas de equipos.</p>';
  // tabla con columna equipo en azul oscuro, celdas en tonos azules
  let html = `<table class="team-stats"><thead>
    <tr>
      <th>Equipo</th>
      <th>Partidos Jugados</th>
      <th>Ganados</th>
      <th>Perdidos</th>
      <th>Goles Favor</th>
      <th>Goles Contra</th>
      <th>Diferencia</th>
      <th>Fase Alcanzada</th>
    </tr>
  </thead><tbody>`;
  stats.standings.forEach(t => {
    const diff = (t.diferencia > 0) ? `+${t.diferencia}` : `${t.diferencia}`;
    html += `<tr>
      <td class="team-name">${escapeHtml(t.nombre)}</td>
      <td>${t.partidos}</td>
      <td>${t.ganados}</td>
      <td>${t.perdidos}</td>
      <td>${t.golesFavor}</td>
      <td>${t.golesContra}</td>
      <td>${diff}</td>
      <td>${escapeHtml(t.faseAlcanzada || '')}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  return html;
}

function renderScorersHtml(scorers){
  if(!scorers || scorers.length === 0) return '<p>No hay goleadores registrados.</p>';
  let html = '<table class="report-table"><thead><tr><th>#</th><th>Jugador</th><th>Goles</th></tr></thead><tbody>';
  scorers.forEach((s,i) => html += `<tr><td>${i+1}</td><td>${escapeHtml(s.jugador)}</td><td>${s.goles}</td></tr>`);
  html += '</tbody></table>';
  return html;
}

function renderGeneralInfo(model, stats){
  if(!model.torneo) return '<p>No hay información general del torneo.</p>';
  const totalEquipos = (model.equipos && model.equipos.length) || 0;
  let totalPartidos = 0, totalGoles = 0;
  Object.values(model.eliminacion || {}).forEach(fase => {
    fase.forEach(p => {
      const parsed = parseScore(p.resultado);
      if(p.resultado && parsed){
        totalPartidos++;
        const a = parsed.a, b = parsed.b;
        totalGoles += a + b;
      }
    });
  });
  const maxScorer = (stats && stats.scorers && stats.scorers.length) ? stats.scorers[0] : null;
  let html = `<div class="card-grid">
    <div class="card"><h4>Torneo</h4><p>${escapeHtml(model.torneo.nombre || '')}</p></div>
    <div class="card"><h4>Equipos</h4><p>${totalEquipos}</p></div>
    <div class="card"><h4>Partidos Jugados</h4><p>${totalPartidos}</p></div>
    <div class="card"><h4>Goles Totales</h4><p>${totalGoles}</p></div>`;
  if(maxScorer) html += `<div class="card"><h4>Máximo Goleador</h4><p>${escapeHtml(maxScorer.jugador)} (${maxScorer.goles})</p></div>`;
  html += '</div>';
  return html;
}

/* ============================
   UI wiring: DOM interactions
   ============================ */
document.addEventListener('DOMContentLoaded', () => {
  console.log('🚀 TourneyJS: Script cargado correctamente');
  console.log('🔧 Verificando funciones globales...');
  console.log('parseScore:', typeof parseScore);
  console.log('scan:', typeof scan);
  console.log('buildModel:', typeof buildModel);
  console.log('computeStats:', typeof computeStats);
  console.log('generateDOT:', typeof generateDOT);
  
  // Tab navigation
  const navLinks = document.querySelectorAll('.sidebar nav a');
  const tabs = document.querySelectorAll('.tab');
  navLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const target = link.getAttribute('href').substring(1);
      navLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      tabs.forEach(tab => tab.classList.toggle('active', tab.id === target));
    });
  });

  // DOM elements
  const inputText = document.getElementById('inputText');
  const fileInput = document.getElementById('fileInput');
  const loadExampleBtn = document.getElementById('loadExample');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const exportReportBtn = document.getElementById('exportReport');
  const tokensTableBody = document.querySelector('#tokensTable tbody');
  const errorsTableBody = document.querySelector('#errorsTable tbody');
  const messagesEl = document.getElementById('messages');
  const reportArea = document.getElementById('reportArea');
  const graphDiv = document.getElementById('graph');

  // Verificar que los elementos críticos existan
  const criticalElements = {
    inputText, fileInput, loadExampleBtn, analyzeBtn, messagesEl
  };
  
  for(const [name, element] of Object.entries(criticalElements)) {
    if(!element) {
      console.error(` Elemento crítico no encontrado: ${name}`);
      return;
    }
  }
  
  console.log(' Todos los elementos DOM críticos encontrados');

  const showStandingsBtn = document.getElementById('showStandings');
  const showStatsBtn = document.getElementById('showStats');
  const showScorersBtn = document.getElementById('showScorers');
  const showBracketReportBtn = document.getElementById('showBracketReport');
  const showTeamStatsBtn = document.getElementById('showTeamStats');
  const showGeneralInfoBtn = document.getElementById('showGeneralInfo');
  const downloadHtmlReportBtn = document.getElementById('downloadHtmlReport');
  const downloadDotBtn = document.getElementById('downloadDot');

  // Example content
  const exampleText = `TORNEO { nombre: "Copa Mundo", equipos: 4 }
EQUIPOS {
  equipo: "Leones FC" [jugador: "Pedro Martínez" [posicion: "DELANTERO", numero: 9, edad: 24], jugador: "Luis García" [posicion: "MEDIOCAMPO", numero: 6, edad: 26]],
  equipo: "Águilas United" [jugador: "Diego Ramírez" [posicion: "DELANTERO", numero: 10, edad: 28]],
  equipo: "Cóndores FC" [jugador: "Valeria Cruz" [posicion: "DELANTERO", numero: 11, edad: 22]],
  equipo: "Tigres Academy" [jugador: "Sofia Hernández" [posicion: "DELANTERO", numero: 7, edad: 21]]
}
ELIMINACION {
  cuartos: [
    partido: "Leones FC" vs "Cóndores FC" [resultado: "3-1", goleadores: ["Pedro Martínez","Valeria Cruz"]],
    partido: "Águilas United" vs "Tigres Academy" [resultado: "2-0", goleadores: ["Diego Ramírez"]]
  ],
  semifinal: [
    partido: "Leones FC" vs "Águilas United" [resultado: "1-0", goleadores: ["Pedro Martínez"]]
  ],
  final: [
    partido: "Leones FC" vs "TBD" [resultado: "-", goleadores: []]
  ]
}`;

  // lectura de archivo
  fileInput.addEventListener('change', (ev) => {
    const f = ev.target.files[0];
    if(!f) {
      messagesEl.textContent = ' No se seleccionó ningún archivo.';
      return;
    }
    
    // Validar tipo de archivo
    if(!f.name.toLowerCase().endsWith('.txt') && f.type !== 'text/plain') {
      messagesEl.textContent = 'Por favor selecciona un archivo .txt válido.';
      return;
    }
    
    messagesEl.textContent = ` Cargando archivo: ${f.name}...`;
    
    const reader = new FileReader();
    
    reader.onload = e => {
      try {
        const content = e.target.result;
        if(content === null || content === undefined) {
          messagesEl.textContent = ' Error: el archivo está vacío o no se pudo leer.';
          return;
        }
        inputText.value = content;
        messagesEl.textContent = ` Archivo cargado: ${f.name} (${content.length} caracteres)`;
      } catch(error) {
        messagesEl.textContent = ` Error al procesar el archivo: ${error.message}`;
        console.error('Error al cargar archivo:', error);
      }
    };
    
    reader.onerror = e => {
      messagesEl.textContent = ` Error al leer el archivo: ${e.target.error}`;
      console.error('Error FileReader:', e.target.error);
    };
    
    reader.onabort = e => {
      messagesEl.textContent = 'Carga de archivo cancelada.';
    };
    
    
    reader.readAsText(f, 'UTF-8');
  });

  loadExampleBtn.addEventListener('click', () => {
    console.log('Cargando ejemplo...');
    inputText.value = exampleText;
    messagesEl.textContent = 'Ejemplo cargado. Presiona "Analizar".';
    console.log('Ejemplo cargado exitosamente');
  });

  
  let lastAnalysis = {tokens: [], errors: [], model: null, stats: null, dot: ""};

  // Presentación: formatea lexema y etiqueta legible del tipo de token
  function formatLexeme(t){
    if(!t) return '';
    const lex = t.lexeme ?? '';
    switch(t.type){
      case TokenType.STRING: return `"${escapeHtml(lex)}"`;
      case TokenType.RESERVED: return `"${escapeHtml(String(lex).toUpperCase())}"`;
      case TokenType.IDENT: return `"${escapeHtml(lex)}"`;
      case TokenType.NUMBER: return `${escapeHtml(lex)}`;
      case TokenType.VS: return `"${escapeHtml(lex)}"`;
      default: return escapeHtml(lex);
    }
  }
  function tokenTypeLabel(t){
    if(!t) return '';
    switch(t.type){
      case TokenType.RESERVED: return 'Palabra Reservada';
      case TokenType.IDENT: return 'Identificador';
      case TokenType.STRING: return 'Cadena';
      case TokenType.NUMBER: return 'Número';
      case TokenType.VS: return 'VS';
      case TokenType.LBRACE: return 'Llave Izquierda';
      case TokenType.RBRACE: return 'Llave Derecha';
      case TokenType.LBRACKET: return 'Corchete Izquierda';
      case TokenType.RBRACKET: return 'Corchete Derecha';
      case TokenType.COLON: return 'Dos Puntos';
      case TokenType.COMMA: return 'Coma';
      case TokenType.SEMICOLON: return 'Punto y Coma';
      default: return t.type;
    }
  }

  //  mensajes para el usuario si no hay análisis
  function noAnalysisMessage() {
    messagesEl.textContent = 'Aún no hay resultados. Presiona "Analizar" primero.';
    reportArea.innerHTML = '<p style="color:#fbbf24;">No hay reporte: ejecuta el análisis primero.</p>';
  }

  // Wiring global de botones para que funcionen antes/después del análisis
  showStandingsBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.stats) { reportArea.innerHTML = renderTeamStats(lastAnalysis.stats); navTo('reports'); }
    else noAnalysisMessage();
  });
  showStatsBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.stats) { reportArea.innerHTML = renderTeamStats(lastAnalysis.stats); navTo('reports'); }
    else noAnalysisMessage();
  });
  showScorersBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.stats) { reportArea.innerHTML = '<h3>Goleadores</h3>' + renderScorersHtml(lastAnalysis.stats.scorers); navTo('reports'); }
    else noAnalysisMessage();
  });
  showBracketReportBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.model) { reportArea.innerHTML = renderBracketReport(lastAnalysis.model); navTo('reports'); }
    else noAnalysisMessage();
  });
  showTeamStatsBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.stats) { reportArea.innerHTML = renderTeamStats(lastAnalysis.stats); navTo('reports'); }
    else noAnalysisMessage();
  });
  showGeneralInfoBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.model) { reportArea.innerHTML = renderGeneralInfo(lastAnalysis.model, lastAnalysis.stats); navTo('reports'); }
    else noAnalysisMessage();
  });

  // Descargas también comprobarán lastAnalysis
  downloadDotBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.dot) downloadBlob('bracket.dot', lastAnalysis.dot, 'text/plain');
    else noAnalysisMessage();
  });
  downloadHtmlReportBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.model) { const html = generateHtmlReport(lastAnalysis); downloadBlob('Reporte_TourneyJS.html', html, 'text/html;charset=utf-8'); }
    else noAnalysisMessage();
  });
  exportReportBtn.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.model) { const html = generateHtmlReport(lastAnalysis); downloadBlob('Reporte_TourneyJS.html', html, 'text/html;charset=utf-8'); }
    else noAnalysisMessage();
  });

  // Analyze button
  analyzeBtn.addEventListener('click', () => {
    console.log(' Botón Analizar presionado');
    const txt = inputText.value || "";
    console.log(` Contenido del textarea: "${txt}" (${txt.length} caracteres)`);
    
    if(!txt.trim()){
      console.log(' Texto vacío detectado');
      messagesEl.textContent = ' El área de entrada está vacía.';
      return;
    }
    
    console.log(' Iniciando análisis...');

    analyzeBtn.disabled = true;
    messagesEl.textContent = 'Analizando (fase 1/2)...';

    //Fase 1: escaneo, análisis, estadísticas, generación de puntos (sincrónico pero diferido para permitir que la interfaz de usuario se actualice)
    setTimeout(() => {
      console.log(' Fase 1: Iniciando scan y parsing...');
      let tokens = [], scanErrors = [], model = null, buildErrors = [], stats = null, dot = '';
      try {
        console.log('Ejecutando scan...');
        const r = scan(txt);
        tokens = r.tokens; scanErrors = r.errors;
        console.log(`Scan completado: ${tokens.length} tokens, ${scanErrors.length} errores`);

        console.log('Ejecutando buildModel...');
        const b = buildModel(tokens);
        model = b.model; buildErrors = b.errors;
        console.log(`BuildModel completado: ${buildErrors.length} errores adicionales`);

        const allErrors = [...scanErrors, ...buildErrors];
        console.log('Calculando estadísticas...');

        // Verificar que parseScore esté definida
        if (typeof parseScore !== 'function') {
          throw new Error('parseScore no está definida');
        }
        
        stats = computeStats(model);
        console.log(' Generando DOT...');
        dot = generateDOT(model);

        // render tokens/errors immediately
        console.log('Renderizando tokens y errores...');
        tokensTableBody.innerHTML = tokens.map((t,i) => `<tr><td>${i+1}</td><td>${formatLexeme(t)}</td><td>${tokenTypeLabel(t)}</td><td>${t.line}</td><td>${t.col}</td></tr>`).join('');
        errorsTableBody.innerHTML = allErrors.map((e,i) => `<tr><td>${i+1}</td><td>${escapeHtml(e.lexema)}</td><td>${escapeHtml(e.tipo)}</td><td>${escapeHtml(e.descripcion||'')}</td><td>${e.line||''}</td><td>${e.col||''}</td></tr>`).join('');

        // store partial analysis (DOT rendering next)
        lastAnalysis = {tokens, errors: allErrors, model, stats, dot};
        messagesEl.textContent = `Análisis completado. Preparando render DOT (fase 2/2)...`;
        console.log('Análisis completado exitosamente');
      } catch(err) {
        console.error(' Error durante el análisis:', err);
        messagesEl.textContent = 'Error durante el análisis: ' + (err && err.message ? err.message : String(err));
        analyzeBtn.disabled = false;
        return;
      }

      //Fase 2: renderizar DOT (diferido, se puede usar viz.js)
      setTimeout(() => {
        graphDiv.innerHTML = '';
        try {
          if(typeof Viz === 'undefined'){
            graphDiv.textContent = 'Viz.js no está cargado. DOT disponible en la sección Bracket como texto.';
            messagesEl.textContent = ' Viz.js no disponible. Se completó el análisis pero no se puede renderizar el gráfico.';
          } else {
            const viz = new Viz();
            viz.renderSVGElement(lastAnalysis.dot).then(element => {
              graphDiv.appendChild(element);
              messagesEl.textContent = ` Render DOT completado. Tokens: ${lastAnalysis.tokens.length} — Errores: ${lastAnalysis.errors.length}`;
            }).catch(err => {
              graphDiv.textContent = 'Error al renderizar DOT: ' + err;
              messagesEl.textContent = ' Error al renderizar DOT.';
            }).finally(() => {
              analyzeBtn.disabled = false;
            });
            return;
          }
        } catch(err) {
          graphDiv.textContent = 'Error inesperado al intentar renderizar DOT: ' + err;
          messagesEl.textContent = ' Error en la fase DOT.';
        }
        // fallback: enable button if Viz no estaba disponible
        analyzeBtn.disabled = false;
      }, 50); // pequeña espera para actualizar UI antes de render
    }, 20); // pequeña espera para que "Analizando..." se pinte
  }); // analyzeBtn

  // helper navigate to tab
  function navTo(tabId){
    navLinks.forEach(l => l.classList.toggle('active', l.getAttribute('href') === '#'+tabId));
    tabs.forEach(t => t.classList.toggle('active', t.id === tabId));
  }

  // download helper
  function downloadBlob(filename, content, type='text/plain;charset=utf-8'){
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // HTML report generator (embebe los reportes)
  function generateHtmlReport({tokens, errors, model, stats, dot}){
    const styles = `<style>
        body{font-family:Arial,Helvetica,sans-serif;background:#0b1220;color:#e6eef6;padding:20px}
        h1,h2,h3{color:#06b6d4} table{width:100%;border-collapse:collapse;margin-bottom:12px}
        th,td{padding:8px;border:1px solid #233240} th{background:#071a2b;color:#06b6d4}
        .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
        .card{background:#071a2b;padding:12px;border-radius:8px}
        /* estilos team-stats (tema oscuro) */
        .team-stats { width:100%; border-collapse: collapse; margin-top:12px; font-family: Poppins, Arial, sans-serif; color:#e6eef6; }
        .team-stats thead th { background:#071a2b; color:#06b6d4; padding:12px; text-align:left; font-weight:600; border:1px solid rgba(255,255,255,0.03); }
        .team-stats tbody td { padding:12px; border-top:1px solid rgba(255,255,255,0.02); color:#dbeef7; }
        .team-stats tbody tr td:not(.team-name) { background: rgba(6,182,212,0.03); text-align:center; }
        .team-stats tbody tr:nth-child(odd) td:not(.team-name) { background: rgba(6,182,212,0.025); }
        .team-stats tbody td.team-name { background:#0b2a3a; color:#e6eef6; font-weight:600; text-align:left; }
      </style>`;
    return `<!doctype html><html><head><meta charset="utf-8"><title>Reporte TourneyJS</title>${styles}</head><body>
      <h1>Reporte TourneyJS</h1>
      <h2>Tokens</h2>
      <table><thead><tr><th>No</th><th>Lexema</th><th>Tipo</th><th>Línea</th><th>Col</th></tr></thead><tbody>
      ${tokens.map((t,i)=>`<tr><td>${i+1}</td><td>${formatLexeme(t)}</td><td>${tokenTypeLabel(t)}</td><td>${t.line}</td><td>${t.col}</td></tr>`).join('')}
      </tbody></table>

      <h2>Errores</h2>
      <table><thead><tr><th>No</th><th>Lexema</th><th>Tipo</th><th>Descripción</th><th>Línea</th><th>Col</th></tr></thead><tbody>
      ${errors.map((e,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(e.lexema)}</td><td>${escapeHtml(e.tipo)}</td><td>${escapeHtml(e.descripcion||'')}</td><td>${e.line||''}</td><td>${e.col||''}</td></tr>`).join('')}
      </tbody></table>

      <h2>Información General</h2>
      ${renderGeneralInfo(model, stats)}

      <h2>Bracket de Eliminación</h2>
      ${renderBracketReport(model)}

      <h2>Tabla de Posiciones</h2>
      ${renderTeamStats(stats)}

      <h2>Goleadores</h2>
      ${renderScorersHtml(stats.scorers)}

      <h2>DOT (Graphviz)</h2><pre>${escapeHtml(dot)}</pre>
    </body></html>`;
  }

  // optionally preload example text (commented)
  // inputText.value = exampleText;
}); // DOMContentLoaded


