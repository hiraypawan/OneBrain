import {Request,Response,NextFunction} from 'express';
// Legacy JWT issuance and acceptance are disabled. Data remains available for operator-led migration.
export function authenticate(_req:Request,res:Response,_next:NextFunction){res.status(401).json({error:'Legacy sessions are retired. Use the Google-authenticated Workers platform.'});}
export function optionalAuth(req:Request&{user?:any},_res:Response,next:NextFunction){req.user={id:'local-user',email:null};next();}
