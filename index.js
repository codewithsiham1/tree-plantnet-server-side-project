
const express = require('express');
const app=express()
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const port=process.env.PORT||5000;
// midaleware
const corsOptions = {
  origin: ['http://localhost:5173'],
  credentials: true,
};
app.use(cors(corsOptions))
app.use(express.json())
app.use(cookieParser());
 

  // genarate jwt token
  app.post('/jwt',async(req,res)=>{
    console.log("JWT Route Hit", req.body); 
    const email=req.body
    const token=jwt.sign(email,process.env.ACCESS_TOKEN_SECRET,{
      expiresIn:'365d'
    })
    res.cookie('token',token,{
      httpOnly:true,
      secure:process.env.NODE_ENV==='production',
       sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    })
    .send({ success: true })
  })
  // logout
      app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })
// veryfiToken
const veryfiToken=async(req,res,next)=>{
  const token=req.cookies?.token
  console.log("Received token:", token); 
  if(!token){
     return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token,process.env.ACCESS_TOKEN_SECRET,(err,decoded)=>{
    if(err){
      console.log(err)
       return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user=decoded
    next()
  })
}
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.leope.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
  // databasecollection
  const usercollection=client.db('PlantNet').collection('user')
  const plantscollection=client.db('PlantNet').collection('plants')
  const ordercollection=client.db('PlantNet').collection('order')
  // save or update a user in db
  app.post('/user/:email',async(req,res)=>{
 const email=req.params.email
 const query={email}
 const user=req.body
//  check if user exist in db
const isExist=await usercollection.findOne(query)
if(isExist){
  return res.send(isExist)
}
const result=await usercollection.insertOne({...user, role:'customer',timestamp:Date.now(),})
console.log("User Inserted to DB:", result);
res.send(result)
  })
  // save a plant data in db
  app.post('/plants',veryfiToken,async(req,res)=>{
const plant=req.body
const result=await plantscollection.insertOne(plant)
res.send(result)
  })
  // get all plants  from db
  app.get('/plants',async(req,res)=>{
const result=await plantscollection.find().toArray()
res.send(result)
  })
  // get a plants by id
  app.get('/plants/:id',async(req,res)=>{
    const id=req.params.id
    const query={_id:new ObjectId(id)}
    const result=await plantscollection.findOne(query)
    res.send(result)
  })
  // save order data in db
    app.post('/order',veryfiToken,async(req,res)=>{
const orderInfo=req.body
console.log(orderInfo)
const result=await ordercollection.insertOne(orderInfo)
res.send(result)
  })
  // manage plant quantity
 app.patch('/plants/quantity/:id',veryfiToken,async(req,res)=>{
  const id=req.params.id
  const {quantityToUpdate,status}=req.body
  const filter={_id:new ObjectId(id)}
  let updateDoc={
$inc:{quantity:-quantityToUpdate}
  }
  if(status==='increase'){
    updateDoc={
$inc:{quantity:quantityToUpdate}
  }
  }
  const result=await plantscollection.updateOne(filter,updateDoc)
  res.send(result)
 })
//  get all customer order
app.get('/customer-orders/:email',veryfiToken,async(req,res)=>{
const email=req.params.email
const query={'customer.email':email}
const result=await ordercollection.aggregate([
  {
    $match:query,
  },
  {
    $addFields:{
      plantId:{$toObjectId:'$plantId'}
    }
  },
  {
    $lookup:{
      from:'plants',
      localField:'plantId',
      foreignField:'_id',
      as:'plants'
    }
  },
  {
    $unwind:'$plants'
  },
  {
    $addFields:{
      name:'$plants.name',
      image:'$plants.image',
      category:'$plants.category'
    }
  },
  {
    $project:{
      plants:0,
    }
  }
]).toArray()
res.send(result)
})
// cancel/delete order
app.delete('/order/:id',veryfiToken,async(req,res)=>{
  const id=req.params.id
  const query={_id:new ObjectId(id)}
  const order=await ordercollection.findOne(query)
  if(order.status==='delivered') return res.status(409).send('cannot cancled once the product')
  const result=await ordercollection.deleteOne(query)
  res.send(result)
})
// manage user status and role
app.patch('/user/:email',veryfiToken,async(req,res)=>{
  const email=req.params.email
  const query={email}
  const user=await usercollection.findOne(query)
  if(!user || user.status==='requested') return res.status(400).send('You have already request')
  
const updateDoc={
  $set:{
    status:'Requested' 
  }
}
const result=await usercollection.updateOne(query,updateDoc)
res.send(result)
})
// get user role
app.get('/user/role/:email',async(req,res)=>{
  const email=req.params.email
  const result=await usercollection.findOne({email})
  res.send({role:result?.role})
})
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);



app.get('/',(req,res)=>{
    res.send('Hello From PlantNet Server ')
})
app.listen(port,(req,res)=>{
    console.log(`PlantNet Server Is Running on Port:${port}`)
})