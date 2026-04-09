// input title
let current = 0, isDeleting = false, index = 0, speed = 150;
function parse(t) {
    let parts = [], m, i = 0, re = /{([^}]+)::([^}]+)}/g;
    while ((m = re.exec(t)) !== null) {
        if (m.index > i) parts.push({text: t.slice(i, m.index), color: null});
        parts.push({text: m[2], color: m[1]});
        i = m.index + m[0].length;
    }
    if (i < t.length) parts.push({text: t.slice(i), color: null});
    return parts;
}
function build(parts, len) {
    let out = '', acc = 0;
    for (let p of parts) {
        if (acc >= len) break;
        let slice = p.text.slice(0, len - acc);
        out += p.color ? `<span style="color:${p.color}">${slice}</span>` : slice;
        acc += p.text.length;
    }
    return out;
}
function type() {
    let phrase = phrases[current];
    let formatted = phrase.includes('{');
    if (isDeleting) index--; else index++;
    let html = formatted ? build(parse(phrase), index) : phrase.slice(0, index);
    document.getElementById('logo-text').innerHTML = html;
    if (!isDeleting && index === phrase.length) {
        speed = 1000; isDeleting = true;}
    else if (isDeleting && index === 0) { 
        isDeleting = false; current = (current + 1) % phrases.length;}
    else if (isDeleting) {
        speed = 20;}
    else {
        speed = 20};
    setTimeout(type, speed);
}
setTimeout(type, 0);