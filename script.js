const G={'k':'♚','q':'♛','r':'♜','b':'♝','n':'♞','p':'♟'};
const $=id=>document.getElementById(id);
let game=new Chess(),engine=new Engine(),me='w',flipped=false,sel=null,hints=[],busy=false,over=false;

function render(){
  const b=$('board');b.innerHTML='';
  const hist=game.history({verbose:true}),last=hist[hist.length-1];
  const rows=flipped?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7];
  const cols=flipped?[7,6,5,4,3,2,1,0]:[0,1,2,3,4,5,6,7];
  const bd=game.board();
  let kingSq=null;
  if(game.in_check())bd.forEach((r,i)=>r.forEach((p,j)=>{if(p&&p.type==='k'&&p.color===game.turn())kingSq='abcdefgh'[j]+(8-i)}));
  rows.forEach(r=>cols.forEach(c=>{
    const sq='abcdefgh'[c]+(8-r),p=bd[r][c];
    const d=document.createElement('div');
    d.className='sq '+((r+c)%2?'d':'l');
    d.dataset.sq=sq;
    if(last&&(sq===last.from||sq===last.to))d.classList.add('last');
    if(sq===sel)d.classList.add('sel');
    if(sq===kingSq)d.classList.add('chk');
    const h=hints.find(m=>m.to===sq);
    if(h){d.classList.add('hint');if(h.captured||h.flags.includes('e'))d.classList.add('cap');}
    if(p){
      const s=document.createElement('span');
      s.className='p '+p.color;s.textContent=G[p.type]+'\uFE0E';
      if(p.color===me&&!busy&&!over){s.draggable=true;
        s.ondragstart=e=>{e.dataTransfer.setData('t',sq);pick(sq)};}
      d.appendChild(s);
    }
    d.onclick=()=>click(sq);
    d.ondragover=e=>e.preventDefault();
    d.ondrop=e=>{e.preventDefault();const f=e.dataTransfer.getData('t');if(f)tryMove(f,sq)};
    b.appendChild(d);
  }));
  // history
  const ol=$('moves');ol.innerHTML='';
  const sans=game.history();
  for(let i=0;i<sans.length;i+=2){
    const li=document.createElement('li');
    li.textContent=sans[i]+(sans[i+1]?'  '+sans[i+1]:'');ol.appendChild(li);
  }
  ol.scrollTop=ol.scrollHeight;
  // captured
  const cw=[],cb=[];
  hist.forEach(m=>{if(m.captured)(m.color==='w'?cw:cb).push(m.captured)});
  const order='qrbnp';
  const fmt=(a,col)=>a.sort((x,y)=>order.indexOf(x)-order.indexOf(y)).map(t=>`<span class="p ${col}">${G[t]}\uFE0E</span>`).join('');
  $('capW').innerHTML=fmt(cw,'b');
  $('capB').innerHTML=fmt(cb,'w');
}
function setStatus(t){$('status').textContent=t}
function pick(sq){
  sel=sq;hints=game.moves({square:sq,verbose:true});render();
}
function click(sq){
  if(busy||over||game.turn()!==me)return;
  if(sel&&hints.some(m=>m.to===sq))return tryMove(sel,sq);
  const p=game.get(sq);
  if(p&&p.color===me)pick(sq);else{sel=null;hints=[];render();}
}
function tryMove(from,to){
  const m=game.moves({square:from,verbose:true}).filter(x=>x.to===to);
  if(!m.length){sel=null;hints=[];render();return;}
  if(m[0].promotion){
    const pb=$('promoBtns');pb.innerHTML='';
    ['q','r','b','n'].forEach(t=>{
      const bt=document.createElement('button');
      bt.innerHTML=`<span class="p ${me}">${G[t]}\uFE0E</span>`;
      bt.onclick=()=>{$('promo').classList.remove('show');doMove(from,to,t)};
      pb.appendChild(bt);
    });
    $('promo').classList.add('show');return;
  }
  doMove(from,to);
}
function doMove(from,to,promotion){
  game.move({from,to,promotion});sel=null;hints=[];render();
  if(!checkEnd())aiMove();
}
function aiMove(){
  busy=true;setStatus('حریف در حال فکر کردن…');
  engine.think(game.fen(),+$('level').value,uci=>{
    busy=false;
    if(!uci||uci==='(none)')return;
    game.move({from:uci.slice(0,2),to:uci.slice(2,4),promotion:uci[4]});
    render();
    if(!checkEnd())setStatus(game.in_check()?'کیش! نوبت شماست':'نوبت شماست');
  });
}
function checkEnd(){
  if(!game.game_over()){setStatus(game.in_check()?'کیش!':'نوبت '+(game.turn()===me?'شماست':'حریف'));return false;}
  over=true;
  let m='تساوی';
  if(game.in_checkmate())m='کیش و مات! '+(game.turn()===me?'شما باختید':'شما بردید');
  else if(game.in_stalemate())m='پات — تساوی';
  end(m);return true;
}
function end(m){over=true;setStatus(m);$('endMsg').textContent=m;$('end').classList.add('show');render();}
function newGame(){
  engine.stop();busy=false;over=false;game=new Chess();sel=null;hints=[];
  me=$('color').value;flipped=me==='b';
  $('end').classList.remove('show');render();setStatus('نوبت شماست');
  if(me==='b')aiMove();
}
$('new').onclick=$('again').onclick=newGame;
$('color').onchange=newGame;
$('flip').onclick=()=>{flipped=!flipped;render()};
$('resign').onclick=()=>{if(!over)end('شما تسلیم شدید')};
$('undo').onclick=()=>{
  if(busy||over)return;
  game.undo();if(game.turn()!==me)game.undo();
  sel=null;hints=[];render();setStatus('نوبت شماست');
};
newGame();
