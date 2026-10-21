const SF='https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js';
const LEVELS=[
  {skill:1,depth:2,time:200},
  {skill:8,depth:8,time:500},
  {skill:15,depth:16,time:1200},
  {skill:20,depth:30,time:3000}
];
class Engine{
  constructor(){
    const blob=new Blob([`importScripts('${SF}')`],{type:'application/javascript'});
    this.w=new Worker(URL.createObjectURL(blob));
    this.cb=null;
    this.w.onmessage=e=>{
      const l=String(e.data);
      if(l.startsWith('bestmove')&&this.cb){const c=this.cb;this.cb=null;c(l.split(' ')[1]);}
    };
    this.w.postMessage('uci');
    this.w.postMessage('setoption name Hash value 64');
  }
  think(fen,lvl,cb){
    const L=LEVELS[lvl];
    this.cb=cb;
    this.w.postMessage('setoption name Skill Level value '+L.skill);
    this.w.postMessage('position fen '+fen);
    this.w.postMessage(`go depth ${L.depth} movetime ${L.time}`);
  }
  stop(){this.cb=null;this.w.postMessage('stop');}
}
