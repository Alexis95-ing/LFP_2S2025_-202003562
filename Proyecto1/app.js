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

//Calcula estadísticas de equipos y goleadores a partir del modelo de datos.

function computeStats(model){
  const teams = {};
  const scorers = []; // Cambiar a array para mantener goles individuales

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
            const name = (typeof g === "string") ? g : (g && g.jugador) ? g.jugador : null;
            if(!name) return;
            
            // Determinar equipo del goleador
            let equipoGoleador = "N/A";
            if(model.equipos && Array.isArray(model.equipos)) {
              for(const equipo of model.equipos) {
                if(equipo.jugadores && equipo.jugadores.some(j => j.nombre === name)) {
                  equipoGoleador = equipo.nombre;
                  break;
                }
              }
            }
            
            // Añadir gol individual
            scorers.push({
              jugador: name,
              equipo: equipoGoleador,
              minuto: (typeof g === "object" && g.minuto) ? g.minuto : null,
              fase: fase // para referencia adicional
            });
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

  // Ordenar goleadores por jugador para agrupar
  const scorersList = scorers.sort((a,b) => {
    if(a.jugador !== b.jugador) return a.jugador.localeCompare(b.jugador);
    return (parseInt(a.minuto) || 0) - (parseInt(b.minuto) || 0);
  });

  return {standings, scorers: scorersList};
}

/* ============================
   generateDOT(model) - Graphviz DOT estilo bracket de torneo
   ============================ */
function generateDOT(model){
  const torneoNombre = (model.torneo && model.torneo.nombre) ? model.torneo.nombre : "Torneo";
  
  let dot = `digraph TorneoBracket {
  rankdir=TB;
  bgcolor="#0b1220";
  fontname="Arial Bold";
  fontsize=16;
  fontcolor="#06b6d4";
  
  // Título del torneo
  label="${torneoNombre}\\nBracket de Eliminación";
  labelloc=t;
  
  // Configuración global de nodos
  node [
    fontname="Arial",
    fontsize=12,
    style="filled,rounded",
    shape=box,
    margin=0.1
  ];
  
  // Configuración global de aristas
  edge [
    color="#06b6d4",
    penwidth=2,
    arrowsize=0.8
  ];
`;

  // Procesar cada fase
  const fases = ['cuartos', 'semifinal', 'final'];
  let nodeCounter = 0;
  
  // Crear nodos por fase
  fases.forEach((fase, faseIndex) => {
    if(model.eliminacion && model.eliminacion[fase]) {
      dot += `\n  // ${fase.toUpperCase()}\n`;
      dot += `  subgraph cluster_${fase} {\n`;
      dot += `    label="${fase.charAt(0).toUpperCase() + fase.slice(1)}";\n`;
      dot += `    fontcolor="#06b6d4";\n`;
      dot += `    color="#233240";\n`;
      dot += `    style="rounded,dashed";\n\n`;
      
      model.eliminacion[fase].forEach((partido, partidoIndex) => {
        const equipoAId = `team_${fase}_${partidoIndex}_A`;
        const equipoBId = `team_${fase}_${partidoIndex}_B`;
        const partidoId = `match_${fase}_${partidoIndex}`;
        
        // Determinar ganador y colores
        let equipoAColor = "#4ade80"; // verde por defecto
        let equipoBColor = "#f87171"; // rojo por defecto
        let ganador = null;
        
        if(partido.resultado && typeof partido.resultado === 'string') {
          const parsed = parseScore(partido.resultado);
          if(parsed) {
            if(parsed.a > parsed.b) {
              ganador = 'A';
              equipoAColor = "#22c55e"; // verde ganador
              equipoBColor = "#6b7280"; // gris perdedor
            } else if(parsed.b > parsed.a) {
              ganador = 'B';
              equipoBColor = "#22c55e"; // verde ganador
              equipoAColor = "#6b7280"; // gris perdedor
            } else {
              equipoAColor = "#f59e0b"; // amarillo empate
              equipoBColor = "#f59e0b";
            }
          }
        }
        
        // Crear nodos de equipos
        const labelA = partido.resultado && parseScore(partido.resultado) ? 
          `${partido.equipoA}\\n${parseScore(partido.resultado).a}` : 
          partido.equipoA;
        const labelB = partido.resultado && parseScore(partido.resultado) ? 
          `${partido.equipoB}\\n${parseScore(partido.resultado).b}` : 
          partido.equipoB;
          
        dot += `    ${equipoAId} [label="${labelA}", fillcolor="${equipoAColor}", fontcolor="white"];\n`;
        dot += `    ${equipoBId} [label="${labelB}", fillcolor="${equipoBColor}", fontcolor="white"];\n`;
        
        // Nodo del partido/resultado
        dot += `    ${partidoId} [label="VS", shape=circle, fillcolor="#06b6d4", fontcolor="white", width=0.5, height=0.5];\n`;
        
        // Conexiones
        dot += `    ${equipoAId} -> ${partidoId} [dir=none];\n`;
        dot += `    ${equipoBId} -> ${partidoId} [dir=none];\n`;
        
        // Si hay siguiente fase, conectar ganador
        if(faseIndex < fases.length - 1 && ganador) {
          const siguienteFase = fases[faseIndex + 1];
          if(model.eliminacion[siguienteFase] && model.eliminacion[siguienteFase][Math.floor(partidoIndex/2)]) {
            const siguientePartido = Math.floor(partidoIndex / 2);
            const siguienteEquipo = partidoIndex % 2 === 0 ? 'A' : 'B';
            const siguienteId = `team_${siguienteFase}_${siguientePartido}_${siguienteEquipo}`;
            
            const ganadorId = ganador === 'A' ? equipoAId : equipoBId;
            dot += `    ${ganadorId} -> ${siguienteId} [color="#ffd700", penwidth=3, label="Ganador"];\n`;
          }
        }
      });
      
      dot += `  }\n\n`;
    }
  });
  
  // Ranking de fases para layout
  dot += `  // Layout ranking\n`;
  if(model.eliminacion.cuartos) {
    dot += `  {rank=same; `;
    model.eliminacion.cuartos.forEach((_, i) => {
      dot += `team_cuartos_${i}_A; team_cuartos_${i}_B; `;
    });
    dot += `}\n`;
  }
  
  if(model.eliminacion.semifinal) {
    dot += `  {rank=same; `;
    model.eliminacion.semifinal.forEach((_, i) => {
      dot += `team_semifinal_${i}_A; team_semifinal_${i}_B; `;
    });
    dot += `}\n`;
  }
  
  if(model.eliminacion.final) {
    dot += `  {rank=same; `;
    model.eliminacion.final.forEach((_, i) => {
      dot += `team_final_${i}_A; team_final_${i}_B; `;
    });
    dot += `}\n`;
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
  
  let html = '<table class="scorers-table"><thead><tr><th>Posición</th><th>Jugador</th><th>Equipo</th><th>Goles</th><th>Minutos de Gol</th></tr></thead><tbody>';
  
  // Agrupar goles por jugador para calcular totales y minutos
  const groupedScorers = {};
  scorers.forEach(s => {
    const key = s.jugador;
    if(!groupedScorers[key]) {
      groupedScorers[key] = {
        jugador: s.jugador,
        equipo: s.equipo,
        goles: 0,
        minutos: []
      };
    }
    groupedScorers[key].goles++;
    if(s.minuto) {
      groupedScorers[key].minutos.push(s.minuto);
    }
  });
  
  // Convertir a array y ordenar por goles (descendente)
  const sortedScorers = Object.values(groupedScorers).sort((a,b) => b.goles - a.goles);
  
  // Renderizar tabla
  sortedScorers.forEach((s,i) => {
    const minutosText = s.minutos.length > 0 ? s.minutos.join(', ') + "'" : 'N/A';
    html += `<tr>
      <td class="position">${i+1}</td>
      <td class="player-name">${escapeHtml(s.jugador)}</td>
      <td class="team-name">${escapeHtml(s.equipo)}</td>
      <td class="goals">${s.goles}</td>
      <td class="minutes">${minutosText}</td>
    </tr>`;
  });
  
  html += '</tbody></table>';
  return html;
}

function renderGeneralInfo(model, stats){
  if(!model.torneo) return '<p>No hay información general del torneo.</p>';
  
  const totalEquipos = (model.equipos && model.equipos.length) || 0;
  let totalPartidos = 0, totalGoles = 0, partidosCompletados = 0;
  
  // Calcular estadísticas de partidos
  Object.values(model.eliminacion || {}).forEach(fase => {
    fase.forEach(p => {
      totalPartidos++; // Total programado
      const parsed = parseScore(p.resultado);
      if(p.resultado && parsed){
        partidosCompletados++;
        const a = parsed.a, b = parsed.b;
        totalGoles += a + b;
      }
    });
  });
  
  // Calcular promedio de goles por partido
  const promedioGoles = partidosCompletados > 0 ? (totalGoles / partidosCompletados).toFixed(1) : '0.0';
  
  // Calcular edad promedio de jugadores
  let totalJugadores = 0, sumaEdades = 0;
  if(model.equipos && Array.isArray(model.equipos)) {
    model.equipos.forEach(equipo => {
      if(equipo.jugadores && Array.isArray(equipo.jugadores)) {
        equipo.jugadores.forEach(jugador => {
          if(jugador.edad && !isNaN(parseInt(jugador.edad))) {
            totalJugadores++;
            sumaEdades += parseInt(jugador.edad);
          }
        });
      }
    });
  }
  const edadPromedio = totalJugadores > 0 ? (sumaEdades / totalJugadores).toFixed(2) : '0.00';
  
  // Determinar fase actual (última fase con partidos completados)
  let faseActual = 'No iniciado';
  const fasesOrden = ['cuartos', 'semifinal', 'final'];
  for(let i = fasesOrden.length - 1; i >= 0; i--) {
    const fase = fasesOrden[i];
    if(model.eliminacion[fase]) {
      const hayCompletados = model.eliminacion[fase].some(p => p.resultado && parseScore(p.resultado));
      if(hayCompletados) {
        faseActual = fase.charAt(0).toUpperCase() + fase.slice(1);
        break;
      }
    }
  }
  
  // Obtener sede desde torneo
  const sede = (model.torneo && model.torneo.sede) ? model.torneo.sede : 'No especificada';
  
  // Crear tabla estilo clave-valor
  let html = `<table class="general-info-table">
    <thead>
      <tr>
        <th>Estadística</th>
        <th>Valor</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td class="stat-label">Nombre del Torneo</td>
        <td class="stat-value">${escapeHtml(model.torneo.nombre || 'No especificado')}</td>
      </tr>
      <tr>
        <td class="stat-label">Sede</td>
        <td class="stat-value">${escapeHtml(sede)}</td>
      </tr>
      <tr>
        <td class="stat-label">Equipos Participantes</td>
        <td class="stat-value">${totalEquipos}</td>
      </tr>
      <tr>
        <td class="stat-label">Total de Partidos Programados</td>
        <td class="stat-value">${totalPartidos}</td>
      </tr>
      <tr>
        <td class="stat-label">Partidos Completados</td>
        <td class="stat-value">${partidosCompletados}</td>
      </tr>
      <tr>
        <td class="stat-label">Total de Goles</td>
        <td class="stat-value">${totalGoles}</td>
      </tr>
      <tr>
        <td class="stat-label">Promedio de Goles por Partido</td>
        <td class="stat-value">${promedioGoles}</td>
      </tr>
      <tr>
        <td class="stat-label">Edad Promedio de Jugadores</td>
        <td class="stat-value">${edadPromedio} años</td>
      </tr>
      <tr>
        <td class="stat-label">Fase Actual</td>
        <td class="stat-value">${faseActual}</td>
      </tr>
    </tbody>
  </table>`;
  return html;
}

/* ============================
   UI wiring: DOM interactions
   ============================ */
document.addEventListener('DOMContentLoaded', () => {
  console.log('TourneyJS: DOM Cargado');
  
  // Verificar que estamos en la página correcta
  console.log('URL actual:', window.location.href);
  console.log('Título de página:', document.title);
  
  // Tab navigation con verificación robusta
  const navLinks = document.querySelectorAll('.sidebar nav a');
  const tabs = document.querySelectorAll('.tab');
  
  console.log(`Encontrados ${navLinks.length} enlaces de navegación`);
  console.log(`Encontradas ${tabs.length} pestañas`);
  
  // Listar todos los enlaces encontrados
  navLinks.forEach((link, i) => {
    console.log(` Enlace ${i+1}: ${link.getAttribute('href')} - "${link.textContent.trim()}"`);
  });
  
  // Listar todas las pestañas encontradas
  tabs.forEach((tab, i) => {
    console.log(`Pestaña ${i+1}: ${tab.id} - activa: ${tab.classList.contains('active')}`);
  });
  
  if(navLinks.length === 0) {
    console.error('No se encontraron enlaces de navegación en .sidebar nav a');
    return;
  }
  
  if(tabs.length === 0) {
    console.error('No se encontraron pestañas con clase .tab');
    return;
  }
  
  // Función helper para navegación
  function navTo(tabId){
    console.log(`Navegando a pestaña: ${tabId}`);
    
    // Remover active de todos los enlaces
    navLinks.forEach(l => l.classList.remove('active'));
    // Remover active de todas las pestañas
    tabs.forEach(t => t.classList.remove('active'));
    
    // Activar enlace correspondiente
    const activeLink = document.querySelector(`.sidebar nav a[href="#${tabId}"]`);
    if(activeLink) {
      activeLink.classList.add('active');
      console.log(`Enlace activado: ${tabId}`);
    } else {
      console.warn(` No se encontró enlace para: ${tabId}`);
    }
    
    // Activar pestaña correspondiente
    const activeTab = document.getElementById(tabId);
    if(activeTab) {
      activeTab.classList.add('active');
      console.log(`Pestaña activada: ${tabId}`);
    } else {
      console.warn(`No se encontró pestaña con ID: ${tabId}`);
    }
  }
  
  // Añadir event listeners a cada enlace
  navLinks.forEach((link, index) => {
    const href = link.getAttribute('href');
    console.log(`🔗 Configurando enlace ${index + 1}: ${href}`);
    
    link.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const target = href.substring(1); // quitar el #
      console.log(`Click en enlace: ${target}`);
      navTo(target);
    });
    
    console.log(`Event listener añadido a enlace ${index + 1}`);
  });

  // DOM elements
  const inputText = document.getElementById('inputText');
  const fileInput = document.getElementById('fileInput');
  const loadExampleBtn = document.getElementById('loadExample');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const tokensTableBody = document.querySelector('#tokensTable tbody');
  const errorsTableBody = document.querySelector('#errorsTable tbody');
  const messagesEl = document.getElementById('messages');
  const reportArea = document.getElementById('reportArea');
  const graphDiv = document.getElementById('graph');

  // Verificar que los elementos críticos existan
  const criticalElements = {
    inputText, fileInput, loadExampleBtn, analyzeBtn, messagesEl, reportArea, graphDiv
  };
  
  for(const [name, element] of Object.entries(criticalElements)) {
    if(!element) {
      console.error(`Elemento crítico no encontrado: ${name}`);
    } else {
      console.log(` Elemento encontrado: ${name}`);
    }
  }

  const showStandingsBtn = document.getElementById('showStandings');
  const showStatsBtn = document.getElementById('showStats');
  const showScorersBtn = document.getElementById('showScorers');
  const showBracketReportBtn = document.getElementById('showBracketReport');
  const showTeamStatsBtn = document.getElementById('showTeamStats');
  const showGeneralInfoBtn = document.getElementById('showGeneralInfo');
  const downloadHtmlReportBtn = document.getElementById('downloadHtmlReport');
  const downloadDotBtn = document.getElementById('downloadDot');
  const downloadPngBtn = document.getElementById('downloadPng');
  const downloadSvgBtn = document.getElementById('downloadSvg');
  
  // Botones de descarga individual
  const downloadTokensReport = document.getElementById('downloadTokensReport');
  const downloadErrorsReport = document.getElementById('downloadErrorsReport');
  const downloadStatsReport = document.getElementById('downloadStatsReport');
  const downloadScorersReport = document.getElementById('downloadScorersReport');
  const downloadBracketHtmlReport = document.getElementById('downloadBracketHtmlReport');

  // Verificar botones de reportes
  const reportButtons = {
    showStandingsBtn, showStatsBtn, showScorersBtn, showBracketReportBtn, 
    showTeamStatsBtn, showGeneralInfoBtn, downloadHtmlReportBtn, downloadDotBtn,
    downloadPngBtn, downloadSvgBtn, downloadTokensReport, downloadErrorsReport,
    downloadStatsReport, downloadScorersReport, downloadBracketHtmlReport
  };
  
  for(const [name, btn] of Object.entries(reportButtons)) {
    if(!btn) {
      console.warn(`Botón no encontrado: ${name}`);
    }
  }

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
      messagesEl.textContent = 'No se seleccionó ningún archivo.';
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
          messagesEl.textContent = 'Error: el archivo está vacío o no se pudo leer.';
          return;
        }
        inputText.value = content;
        messagesEl.textContent = `Archivo cargado: ${f.name} (${content.length} caracteres)`;
      } catch(error) {
        messagesEl.textContent = `Error al procesar el archivo: ${error.message}`;
        console.error('Error al cargar archivo:', error);
      }
    };
    
    reader.onerror = e => {
      messagesEl.textContent = `Error al leer el archivo: ${e.target.error}`;
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

  // Funciones para generar reportes individuales
  function generateTokensReport(tokens) {
    const styles = getReportStyles();
    return `<!doctype html><html><head><meta charset="utf-8"><title>Reporte de Tokens - TourneyJS</title>${styles}</head><body>
      <h1>Reporte de Tokens - TourneyJS</h1>
      <h2>Análisis Léxico</h2>
      <p>Total de tokens encontrados: <strong>${tokens.length}</strong></p>
      <table><thead><tr><th>No</th><th>Lexema</th><th>Tipo</th><th>Línea</th><th>Col</th></tr></thead><tbody>
      ${tokens.map((t,i)=>`<tr><td>${i+1}</td><td>${formatLexeme(t)}</td><td>${tokenTypeLabel(t)}</td><td>${t.line}</td><td>${t.col}</td></tr>`).join('')}
      </tbody></table>
      <footer style="margin-top: 30px; padding: 15px; background: rgba(6,182,212,0.1); border-radius: 8px;">
        <small>Generado por TourneyJS - Analizador Léxico</small>
      </footer>
    </body></html>`;
  }

  function generateErrorsReport(errors) {
    const styles = getReportStyles();
    return `<!doctype html><html><head><meta charset="utf-8"><title>Reporte de Errores - TourneyJS</title>${styles}</head><body>
      <h1>Reporte de Errores - TourneyJS</h1>
      <h2>Errores Encontrados</h2>
      <p>Total de errores: <strong style="color: #ef4444;">${errors.length}</strong></p>
      ${errors.length === 0 ? '<div style="background: rgba(34,197,94,0.2); padding: 15px; border-radius: 8px; color: #22c55e;"><h3>¡Sin errores!</h3><p>El análisis se completó sin errores léxicos o sintácticos.</p></div>' : 
      `<table><thead><tr><th>No</th><th>Lexema</th><th>Tipo</th><th>Descripción</th><th>Línea</th><th>Col</th></tr></thead><tbody>
      ${errors.map((e,i)=>`<tr><td>${i+1}</td><td>${escapeHtml(e.lexema)}</td><td>${escapeHtml(e.tipo)}</td><td>${escapeHtml(e.descripcion||'')}</td><td>${e.line||''}</td><td>${e.col||''}</td></tr>`).join('')}
      </tbody></table>`}
      <footer style="margin-top: 30px; padding: 15px; background: rgba(6,182,212,0.1); border-radius: 8px;">
        <small>Generado por TourneyJS - Analizador Léxico</small>
      </footer>
    </body></html>`;
  }

  function generateStatsReport(model, stats) {
    const styles = getReportStyles();
    return `<!doctype html><html><head><meta charset="utf-8"><title>Estadísticas del Torneo - TourneyJS</title>${styles}</head><body>
      <h1>Estadísticas del Torneo - TourneyJS</h1>
      <h2>Información General</h2>
      ${renderGeneralInfo(model, stats)}
      <h2>Estadísticas por Equipo</h2>
      ${renderTeamStats(stats)}
      <footer style="margin-top: 30px; padding: 15px; background: rgba(6,182,212,0.1); border-radius: 8px;">
        <small>Generado por TourneyJS - Analizador de Torneos</small>
      </footer>
    </body></html>`;
  }

  function generateScorersReport(stats) {
    const styles = getReportStyles();
    return `<!doctype html><html><head><meta charset="utf-8"><title>Tabla de Goleadores - TourneyJS</title>${styles}</head><body>
      <h1>Tabla de Goleadores - TourneyJS</h1>
      <h2>Ranking de Goleadores</h2>
      ${renderScorersHtml(stats.scorers)}
      <footer style="margin-top: 30px; padding: 15px; background: rgba(6,182,212,0.1); border-radius: 8px;">
        <small>Generado por TourneyJS - Analizador de Torneos</small>
      </footer>
    </body></html>`;
  }

  function generateBracketHtmlReport(model) {
    const styles = getReportStyles();
    return `<!doctype html><html><head><meta charset="utf-8"><title>Bracket de Eliminación - TourneyJS</title>${styles}</head><body>
      <h1>Bracket de Eliminación - TourneyJS</h1>
      <h2>Resultados del Torneo</h2>
      ${renderBracketReport(model)}
      <footer style="margin-top: 30px; padding: 15px; background: rgba(6,182,212,0.1); border-radius: 8px;">
        <small>Generado por TourneyJS - Analizador de Torneos</small>
      </footer>
    </body></html>`;
  }

  function getReportStyles() {
    return `<style>
        body{font-family:Arial,Helvetica,sans-serif;background:#0b1220;color:#e6eef6;padding:20px;margin:0;}
        h1,h2,h3{color:#06b6d4; margin-top: 20px; margin-bottom: 15px;} 
        table{width:100%;border-collapse:collapse;margin-bottom:20px;}
        th,td{padding:12px 8px;border:1px solid #233240;text-align:left;} 
        th{background:#071a2b;color:#06b6d4;font-weight:600;}
        tr:nth-child(even){background:rgba(6,182,212,0.02);}
        .card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:20px 0;}
        .card{background:#071a2b;padding:15px;border-radius:8px;border:1px solid rgba(6,182,212,0.1);}
        .card h4{margin:0 0 10px 0;color:#06b6d4;}
        .team-stats { width:100%; border-collapse: collapse; margin-top:12px; font-family: Arial, sans-serif; color:#e6eef6; }
        .team-stats thead th { background:#071a2b; color:#06b6d4; padding:12px; text-align:left; font-weight:600; border:1px solid rgba(255,255,255,0.03); }
        .team-stats tbody td { padding:12px; border-top:1px solid rgba(255,255,255,0.02); color:#dbeef7; }
        .team-stats tbody tr td:not(.team-name) { background: rgba(6,182,212,0.03); text-align:center; }
        .team-stats tbody tr:nth-child(odd) td:not(.team-name) { background: rgba(6,182,212,0.025); }
        .team-stats tbody td.team-name { background:#0b2a3a; color:#e6eef6; font-weight:600; text-align:left; }
        .report-table{width:100%;border-collapse:collapse;}
        .report-table th{background:#071a2b;color:#06b6d4;padding:10px;}
        .report-table td{padding:8px;border-bottom:1px solid rgba(255,255,255,0.05);}
        /* Estilos específicos para tabla de goleadores */
        .scorers-table { width:100%; border-collapse: collapse; margin-top:12px; font-family: Arial, sans-serif; color:#e6eef6; }
        .scorers-table thead th { background:#071a2b; color:#06b6d4; padding:12px; text-align:center; font-weight:600; border:1px solid rgba(255,255,255,0.03); }
        .scorers-table tbody td { padding:12px; border-top:1px solid rgba(255,255,255,0.02); color:#dbeef7; text-align:center; }
        .scorers-table tbody tr:nth-child(even) { background: rgba(6,182,212,0.03); }
        .scorers-table tbody tr:nth-child(odd) { background: rgba(6,182,212,0.025); }
        .scorers-table .position { background:#0b2a3a; color:#e6eef6; font-weight:600; width:80px; }
        .scorers-table .player-name { background:#071a2b; color:#06b6d4; font-weight:600; text-align:left; }
        .scorers-table .team-name { background:#0b2a3a; color:#e6eef6; text-align:left; }
        .scorers-table .goals { background:#22c55e; color:#0b1220; font-weight:600; width:80px; }
        .scorers-table .minutes { background:rgba(6,182,212,0.1); color:#c7f0fb; }
        /* Estilos específicos para tabla de información general */
        .general-info-table { width:100%; border-collapse: collapse; margin-top:12px; font-family: Arial, sans-serif; color:#e6eef6; }
        .general-info-table thead th { background:#4a90b8; color:#ffffff; padding:12px; text-align:center; font-weight:600; border:1px solid rgba(255,255,255,0.1); }
        .general-info-table tbody tr:nth-child(even) { background: #d1e7f0; }
        .general-info-table tbody tr:nth-child(odd) { background: #b8d4e3; }
        .general-info-table .stat-label { background:#4a90b8; color:#ffffff; padding:12px; font-weight:600; text-align:left; border:1px solid rgba(255,255,255,0.1); }
        .general-info-table .stat-value { padding:12px; color:#0b1220; text-align:left; border:1px solid rgba(255,255,255,0.1); }
        footer{text-align:center;color:#94a3b8;}
      </style>`;
  }

  // Función para descargar imagen del gráfico
  function downloadGraphImage(format = 'png') {
    if(!lastAnalysis || !lastAnalysis.dot) {
      noAnalysisMessage();
      return;
    }
    
    try {
      if(typeof Viz === 'undefined') {
        messagesEl.textContent = 'Viz.js no disponible para generar imagen.';
        return;
      }
      
      const viz = new Viz();
      
      if(format === 'png') {
        viz.renderImageElement(lastAnalysis.dot, {format: 'png', scale: 2})
          .then(element => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const img = new Image();
            
            img.onload = function() {
              canvas.width = img.width;
              canvas.height = img.height;
              ctx.drawImage(img, 0, 0);
              
              canvas.toBlob(blob => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'Bracket_TourneyJS.png';
                a.click();
                URL.revokeObjectURL(url);
              }, 'image/png');
            };
            
            img.src = element.src;
          })
          .catch(err => {
            messagesEl.textContent = 'Error al generar PNG: ' + err;
          });
      } else {
        viz.renderSVGElement(lastAnalysis.dot)
          .then(element => {
            const svgData = new XMLSerializer().serializeToString(element);
            const blob = new Blob([svgData], {type: 'image/svg+xml'});
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'Bracket_TourneyJS.svg';
            a.click();
            URL.revokeObjectURL(url);
          })
          .catch(err => {
            messagesEl.textContent = 'Error al generar SVG: ' + err;
          });
      }
    } catch(err) {
      messagesEl.textContent = 'Error al procesar imagen: ' + err;
    }
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
        /* Estilos específicos para tabla de goleadores */
        .scorers-table { width:100%; border-collapse: collapse; margin-top:12px; font-family: Arial, sans-serif; color:#e6eef6; }
        .scorers-table thead th { background:#071a2b; color:#06b6d4; padding:12px; text-align:center; font-weight:600; border:1px solid rgba(255,255,255,0.03); }
        .scorers-table tbody td { padding:12px; border-top:1px solid rgba(255,255,255,0.02); color:#dbeef7; text-align:center; }
        .scorers-table tbody tr:nth-child(even) { background: rgba(6,182,212,0.03); }
        .scorers-table tbody tr:nth-child(odd) { background: rgba(6,182,212,0.025); }
        .scorers-table .position { background:#0b2a3a; color:#e6eef6; font-weight:600; width:80px; }
        .scorers-table .player-name { background:#071a2b; color:#06b6d4; font-weight:600; text-align:left; }
        .scorers-table .team-name { background:#0b2a3a; color:#e6eef6; text-align:left; }
        .scorers-table .goals { background:#22c55e; color:#0b1220; font-weight:600; width:80px; }
        .scorers-table .minutes { background:rgba(6,182,212,0.1); color:#c7f0fb; }
        /* Estilos específicos para tabla de información general */
        .general-info-table { width:100%; border-collapse: collapse; margin-top:12px; font-family: Arial, sans-serif; color:#e6eef6; }
        .general-info-table thead th { background:#4a90b8; color:#ffffff; padding:12px; text-align:center; font-weight:600; border:1px solid rgba(255,255,255,0.1); }
        .general-info-table tbody tr:nth-child(even) { background: #d1e7f0; }
        .general-info-table tbody tr:nth-child(odd) { background: #b8d4e3; }
        .general-info-table .stat-label { background:#4a90b8; color:#ffffff; padding:12px; font-weight:600; text-align:left; border:1px solid rgba(255,255,255,0.1); }
        .general-info-table .stat-value { padding:12px; color:#0b1220; text-align:left; border:1px solid rgba(255,255,255,0.1); }
        footer{text-align:center;color:#94a3b8;}
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

  // Event listeners para descargas individuales
  downloadTokensReport.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.tokens) {
      const html = generateTokensReport(lastAnalysis.tokens);
      downloadBlob('Tokens_TourneyJS.html', html, 'text/html;charset=utf-8');
    } else noAnalysisMessage();
  });
  
  downloadErrorsReport.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.errors !== undefined) {
      const html = generateErrorsReport(lastAnalysis.errors);
      downloadBlob('Errores_TourneyJS.html', html, 'text/html;charset=utf-8');
    } else noAnalysisMessage();
  });
  
  downloadStatsReport.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.model && lastAnalysis.stats) {
      const html = generateStatsReport(lastAnalysis.model, lastAnalysis.stats);
      downloadBlob('Estadisticas_TourneyJS.html', html, 'text/html;charset=utf-8');
    } else noAnalysisMessage();
  });
  
  downloadScorersReport.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.stats) {
      const html = generateScorersReport(lastAnalysis.stats);
      downloadBlob('Goleadores_TourneyJS.html', html, 'text/html;charset=utf-8');
    } else noAnalysisMessage();
  });
  
  downloadBracketHtmlReport.addEventListener('click', () => {
    if(lastAnalysis && lastAnalysis.model) {
      const html = generateBracketHtmlReport(lastAnalysis.model);
      downloadBlob('Bracket_TourneyJS.html', html, 'text/html;charset=utf-8');
    } else noAnalysisMessage();
  });

  // Event listeners para descarga de imágenes
  downloadPngBtn.addEventListener('click', () => downloadGraphImage('png'));
  downloadSvgBtn.addEventListener('click', () => downloadGraphImage('svg'));

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

    setTimeout(() => {
      console.log(' Fase 1: Iniciando scan y parsing...');
      let tokens = [], scanErrors = [], model = null, buildErrors = [], stats = null, dot = '';
      try {
        console.log(' Ejecutando scan...');
        const r = scan(txt);
        tokens = r.tokens; scanErrors = r.errors;
        console.log(` Scan completado: ${tokens.length} tokens, ${scanErrors.length} errores`);

        console.log(' Ejecutando buildModel...');
        const b = buildModel(tokens);
        model = b.model; buildErrors = b.errors;
        console.log(` BuildModel completado: ${buildErrors.length} errores adicionales`);

        const allErrors = [...scanErrors, ...buildErrors];
        console.log(' Calculando estadísticas...');

        if (typeof parseScore !== 'function') {
          throw new Error('parseScore no está definida');
        }
        
        stats = computeStats(model);
        console.log(' Generando DOT...');
        dot = generateDOT(model);

        console.log(' Renderizando tokens y errores...');
        tokensTableBody.innerHTML = tokens.map((t,i) => `<tr><td>${i+1}</td><td>${formatLexeme(t)}</td><td>${tokenTypeLabel(t)}</td><td>${t.line}</td><td>${t.col}</td></tr>`).join('');
        errorsTableBody.innerHTML = allErrors.map((e,i) => `<tr><td>${i+1}</td><td>${escapeHtml(e.lexema)}</td><td>${escapeHtml(e.tipo)}</td><td>${escapeHtml(e.descripcion||'')}</td><td>${e.line||''}</td><td>${e.col||''}</td></tr>`).join('');

        lastAnalysis = {tokens, errors: allErrors, model, stats, dot};
        messagesEl.textContent = `Análisis completado. Preparando render DOT (fase 2/2)...`;
        console.log(' Análisis completado exitosamente');
      } catch(err) {
        console.error(' Error durante el análisis:', err);
        messagesEl.textContent = 'Error durante el análisis: ' + (err && err.message ? err.message : String(err));
        analyzeBtn.disabled = false;
        return;
      }

      setTimeout(() => {
        graphDiv.innerHTML = '';
        try {
          if(typeof Viz === 'undefined'){
            graphDiv.textContent = 'Viz.js no está cargado. DOT disponible en la sección Bracket como texto.';
            messagesEl.textContent = 'Viz.js no disponible. Se completó el análisis pero no se puede renderizar el gráfico.';
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
        analyzeBtn.disabled = false;
      }, 50);
    }, 20);
  });

}); // DOMContentLoaded