import {Router} from 'express';
const router=Router();
router.all('*',(_req,res)=>{res.status(410).json({error:'Legacy authentication is retired. Use Google sign-in on the OneBrain frontend and the Workers platform.'});});
export default router;
