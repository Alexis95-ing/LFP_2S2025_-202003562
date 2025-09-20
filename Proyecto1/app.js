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



