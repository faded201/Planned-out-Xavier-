import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleVision } from '../lib/server/vision.ts';
const request = () => new Request('http://localhost/api/vision',{method:'POST',headers:{Authorization:'Bearer signed-in'},body:JSON.stringify({question:'Describe',images:[{dataUrl:'data:image/png;base64,AA=='}]})});
const base = {authenticate:async()=>true,endpoint:'https://example.openai.azure.com/openai/deployments/vision/chat/completions?api-version=2024-10-21',apiKey:'secret',fetcher:async()=>Response.json({choices:[{message:{content:'red circle'}}]})};
test('free users cannot spend Azure inference',async()=>{let calls=0;const response=await handleVision(request(),{...base,authorizePaid:async()=>false,fetcher:async()=>{calls++;return Response.json({})}});assert.equal(response.status,403);assert.equal(calls,0)});
test('paid users can use configured Azure vision',async()=>{const response=await handleVision(request(),{...base,authorizePaid:async()=>true});assert.equal(response.status,200);assert.equal((await response.json()).observation,'red circle')});
test('entitlement failures do not invoke paid Azure',async()=>{let calls=0;const response=await handleVision(request(),{...base,authorizePaid:async()=>{throw Error('down')},fetcher:async()=>{calls++;return Response.json({})}});assert.equal(response.status,503);assert.equal(calls,0)});
