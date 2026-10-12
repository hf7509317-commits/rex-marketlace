const path=require('node:path');const cwd=path.resolve(__dirname,'..');
module.exports={apps:[
 {name:'rexmarket-api',cwd,script:'dist/src/server.js',instances:1,exec_mode:'fork',autorestart:true,max_memory_restart:'512M',kill_timeout:10000,env:{NODE_ENV:'production'}},
 {name:'rexmarket-bot',cwd,script:'dist/src/bot.js',instances:1,exec_mode:'fork',autorestart:true,max_memory_restart:'512M',kill_timeout:10000,env:{NODE_ENV:'production'}}
]};
