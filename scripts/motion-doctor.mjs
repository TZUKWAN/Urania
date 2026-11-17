#!/usr/bin/env node
import {checkMotionRuntime} from '../host/motion/runtime-env.js';
try { const {workerEnv,...report}=checkMotionRuntime();console.log(JSON.stringify(report,null,2)); }
catch(error){console.log(JSON.stringify({ok:false,component:error.component||'runtime',code:error.code||'E_MOTION_RUNTIME',error:error.message,recovery:error.recovery},null,2));process.exitCode=1;}
