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
  const token = [];
  const errores =[];
  let i = 0, line = 1, col = 0;

  function current (){ return text[i]; }
  function lookahead(k=1){ return text[i+k] || null; }
  function advance(){
    const ch = text[i++];
    if(ch === '\n'){ line++; col = 0; } else { col++; }
    return ch;
  }

  function addToken(type, lexeme, l, col){tokens.push({type, lexeme, line:l, col:c});}
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


