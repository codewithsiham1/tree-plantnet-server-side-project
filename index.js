const express = require('express');
const nodemailer = require("nodemailer");
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require('stripe')(process.env.PAYMENT_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');

const app = express();
const port = process.env.PORT || 5000;

// Middleware setup
const corsOptions = {
  origin: [
    'http://localhost:5173', 
    'https://tree-plantnet-client-project.onrender.com'
    
  ],
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// MongoDB client setup
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.leope.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

// Nodemailer email sending function
const sendEmail = (emailAddress, emailData) => {
  const transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, 
    auth: {
      user: process.env.NODEMAILER_USER,
      pass: process.env.NODEMAILER_PASS,
    },
  });

  transporter.verify((error, success) => {
    if (error) {
      console.log('Email transporter error:', error);
    } else {
      console.log('Email transporter ready');
    }
  });

  const mailOptions = {
    from: process.env.NODEMAILER_USER,
    to: emailAddress,
    subject: emailData?.subject,
    text: emailData?.message,
    html: `<p>${emailData?.message}</p>`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Email send error:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
};

// JWT Token generation route
app.post('/jwt', (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).send({ message: 'Email required' });

  const token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, {
    expiresIn: '365d'
  });

  res.cookie('token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 365,
  }).send({ success: true });
});

// Logout route
app.get('/logout', (req, res) => {
  res.clearCookie('token', {
    maxAge: 0,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
  }).send({ success: true });
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return res.status(401).send({ message: 'Unauthorized access' });

  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log('JWT verification error:', err);
      return res.status(401).send({ message: 'Unauthorized access' });
    }
    req.user = decoded;
    next();
  });
};

// Middleware to verify admin role
const verifyAdmin = async (req, res, next) => {
  const email = req.user.email;
  const user = await usercollection.findOne({ email });
  if (!user || user.role !== 'admin') {
    return res.status(403).send({ message: 'Unauthorized Access: Admin only' });
  }
  next();
};

// Middleware to verify seller role
const verifySeller = async (req, res, next) => {
  const email = req.user.email;
  const user = await usercollection.findOne({ email });
  if (!user || user.role !== 'seller') {
    return res.status(403).send({ message: 'Unauthorized Access: Seller only' });
  }
  next();
};

let usercollection, plantscollection, ordercollection, reviewcollection, contactcollection;

async function run() {
  try {
    await client.connect();

    usercollection = client.db('PlantNet').collection('user');
    plantscollection = client.db('PlantNet').collection('plants');
    ordercollection = client.db('PlantNet').collection('order');
    reviewcollection = client.db('PlantNet').collection('review');
    contactcollection = client.db('PlantNet').collection('contact');

    // Save or update a user
    app.post('/user/:email', async (req, res) => {
      const email = req.params.email;
      const userData = req.body;

      const existingUser = await usercollection.findOne({ email });
      if (existingUser) {
        return res.send(existingUser);
      }

      const result = await usercollection.insertOne({ ...userData, role: 'customer', timestamp: Date.now() });
      res.send(result);
    });

    // Add a new plant - Seller only
    app.post('/plants', verifyToken, verifySeller, async (req, res) => {
      const plant = req.body;
      const result = await plantscollection.insertOne(plant);
      res.send(result);
    });

    // Get all plants
    app.get('/plants', async (req, res) => {
      const plants = await plantscollection.find().toArray();
      res.send(plants);
    });

    // Get plant by id
    app.get('/plants/:id', async (req, res) => {
      const id = req.params.id;
      if (!ObjectId.isValid(id)) return res.status(400).send({ error: 'Invalid ObjectId' });

      const plant = await plantscollection.findOne({ _id: new ObjectId(id) });
      res.send(plant);
    });

    // Create order - user must be logged in
    app.post('/order', verifyToken, async (req, res) => {
      const orderInfo = req.body;
      const result = await ordercollection.insertOne(orderInfo);

      if (result.insertedId) {
        sendEmail(orderInfo.customer, {
          subject: 'Order successful',
          message: `You have placed an order successfully. Transaction Id: ${result.insertedId}`
        });

        sendEmail(orderInfo.seller, {
          subject: 'New order received',
          message: `Please process the order for: ${orderInfo.customer}`
        });
      }

      res.send(result);
    });

    // Update plant quantity (increase/decrease)
    app.patch('/plants/quantity/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const { quantityToUpdate, status } = req.body;
      const filter = { _id: new ObjectId(id) };

      let updateDoc;
      if (status === 'increase') {
        updateDoc = { $inc: { quantity: quantityToUpdate } };
      } else {
        updateDoc = { $inc: { quantity: -quantityToUpdate } };
      }

      const result = await plantscollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    // Get customer orders
    app.get('/customer-orders/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const orders = await ordercollection.aggregate([
        { $match: { 'customer.email': email } },
        { $addFields: { plantId: { $toObjectId: '$plantId' } } },
        { $lookup: { from: 'plants', localField: 'plantId', foreignField: '_id', as: 'plants' } },
        { $unwind: '$plants' },
        { $addFields: { name: '$plants.name', image: '$plants.image', category: '$plants.category' } },
        { $project: { plants: 0 } }
      ]).toArray();
      res.send(orders);
    });

    // Get seller orders
    app.get('/seller-orders', verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;
      const orders = await ordercollection.aggregate([
        { $match: { "seller.email": email } },
        { $addFields: { plantId: { $convert: { input: "$plantId", to: "objectId", onError: null, onNull: null } } } },
        { $lookup: { from: "plants", localField: "plantId", foreignField: "_id", as: "plants" } },
        { $unwind: "$plants" },
        { $addFields: { name: "$plants.name" } },
        { $project: { plants: 0 } }
      ]).toArray();
      res.send(orders);
    });

    // Delete/cancel order if not delivered
    app.delete('/order/:id', verifyToken, async (req, res) => {
      const id = req.params.id;
      const order = await ordercollection.findOne({ _id: new ObjectId(id) });

      if (!order) return res.status(404).send('Order not found');
      if (order.status === 'delivered') return res.status(409).send('Cannot cancel a delivered product');

      const result = await ordercollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Update user status to Requested
    app.patch('/user/:email', verifyToken, async (req, res) => {
      const email = req.params.email;
      const user = await usercollection.findOne({ email });
      if (!user || user.status === 'requested') return res.status(400).send('You have already requested');

      const result = await usercollection.updateOne({ email }, { $set: { status: 'Requested' } });
      res.send(result);
    });

    // Get user role by email
    app.get('/user/role/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usercollection.findOne({ email });
      res.send({ role: user?.role || 'customer' });
    });

    // Get all users except current admin
    app.get('/all-user/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const users = await usercollection.find({ email: { $ne: email } }).toArray();
      res.send(users);
    });

    // Update user role and status by admin
    app.patch('/user/role/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const { role } = req.body;
      const result = await usercollection.updateOne(
        { email },
        { $set: { role, status: 'Verified' } }
      );
      res.send(result);
    });

    // Get plants of seller
    app.get('/plants/seller', verifyToken, verifySeller, async (req, res) => {
      const email = req.user.email;
      const plants = await plantscollection.find({ 'seller.email': email }).toArray();
      res.send(plants);
    });

    // Delete plant by seller
    app.delete('/plants/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const result = await plantscollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // Update order status by seller
    app.patch('/orders/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const result = await ordercollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } }
      );
      res.send(result);
    });

    // Admin dashboard stats
    app.get('/admin-stat', verifyToken, verifyAdmin, async (req, res) => {
      const totalUsers = await usercollection.countDocuments({ role: 'admin' });
      const totalPlants = await plantscollection.estimatedDocumentCount();
      const allOrders = await ordercollection.find().toArray();

      const chartData = await ordercollection.aggregate([
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: { $toDate: '$_id' } }
            },
            quantity: { $sum: '$quantity' },
            price: { $sum: '$price' },
            orderCount: { $sum: 1 }
          }
        },
        {
          $project: {
            _id: 0,
            date: '$_id',
            quantity: 1,
            orderCount: 1,
            price: 1
          }
        },
        { $sort: { date: 1 } }
      ]).toArray();

      const orderSummary = await ordercollection.aggregate([
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$price' },
            totalOrders: { $sum: 1 }
          }
        },
        { $project: { _id: 0 } }
      ]).next();

      res.send({ totalUsers, totalPlants, ...orderSummary, chartData });
    });

    // Create payment intent for Stripe
    app.post('/create-payment', verifyToken, async (req, res) => {
      const { quantity, plantId } = req.body;
      const plant = await plantscollection.findOne({ _id: new ObjectId(plantId) });

      if (!plant) return res.status(400).send({ message: 'Plant not found' });

      const totalPrice = quantity * plant.price * 100; // cents
      const paymentIntent = await stripe.paymentIntents.create({
        amount: totalPrice,
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
      });

      res.send({ clientSecret: paymentIntent.client_secret });
    });

    // Update plant data - seller only
    app.patch('/plants/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id;
      const updatedData = req.body;
      const result = await plantscollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
      res.send(result);
    });

    // Add review
    app.post('/review', verifyToken, async (req, res) => {
      try {
        const { plantId, orderId, rating, comment } = req.body;
        const review = {
          plantId: new ObjectId(plantId),
          orderId: new ObjectId(orderId),
          rating: +rating,
          comment,
          userEmail: req.user.email,
          createdAt: new Date()
        };

        const result = await reviewcollection.insertOne(review);

        await ordercollection.updateOne(
          { _id: new ObjectId(orderId) },
          { $set: { review: true } }
        );

        res.send(result);
      } catch (error) {
        console.error('Review error:', error);
        res.status(500).json({ error: 'Something went wrong' });
      }
    });

    // Get reviews with user info
    app.get('/review', async (req, res) => {
      try {
        const reviews = await reviewcollection.aggregate([
          {
            $lookup: {
              from: 'user',
              localField: 'userEmail',
              foreignField: 'email',
              as: 'userInfo'
            }
          },
          { $unwind: '$userInfo' },
          {
            $project: {
              plantId: 1,
              orderId: 1,
              rating: 1,
              comment: 1,
              createdAt: 1,
              'userInfo.name': 1,
              'userInfo.image': 1
            }
          }
        ]).toArray();
        res.send(reviews);
      } catch (err) {
        console.error('Review fetch error:', err);
        res.status(500).send({ error: 'Failed to fetch reviews with user info' });
      }
    });

    // Get rating stats for a plant
    app.get('/review/stat/:plantId', async (req, res) => {
      const plantId = req.params.plantId;
      try {
        const stats = await reviewcollection.aggregate([
          { $match: { plantId: new ObjectId(plantId) } },
          { $group: { _id: '$plantId', averageRating: { $avg: '$rating' } } }
        ]).toArray();

        if (stats.length > 0) {
          res.send({ averageRating: stats[0].averageRating });
        } else {
          res.send({ averageRating: 0 });
        }
      } catch (err) {
        console.error('Rating stats error:', err);
        res.status(500).send({ error: 'Failed to fetch rating stats' });
      }
    });

    // Contact form - save contact info
    app.post('/contact', async (req, res) => {
      const contact = { ...req.body, createdAt: new Date() };
      const result = await contactcollection.insertOne(contact);
      res.send(result);
    });

    // Get contact messages - admin only
    app.get('/contact', verifyToken, verifyAdmin, async (req, res) => {
      const contacts = await contactcollection.find().sort({ createdAt: -1 }).toArray();
      res.send(contacts);
    });

  } catch (err) {
    console.error('Server startup error:', err);
  }
}

run().catch(console.dir);

// Root route
app.get('/', (req, res) => {
  res.send('Hello From PlantNet Server');
});

// Start server
app.listen(port, () => {
  console.log(`PlantNet Server Is Running on Port: ${port}`);
});


