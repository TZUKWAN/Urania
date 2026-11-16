process.stdin.resume();process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({type:'progress',progress:{entered:true}})+'\n',()=>{while(true){Math.sqrt(123.45);}});});
