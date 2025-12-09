const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion } = require("mongodb");

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Test route
app.get("/", (req, res) => {
  res.send("AidEx. Server is Running");
});

const uri = process.env.MONGO_URI;

// MongoDB
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    console.log("✅ Successfully connected to MongoDB!");

    const AidExDB = client.db("AidExDB");
    const usersCollection = AidExDB.collection("usersCollection");
    const donationRequests = AidExDB.collection("donationRequests");

    // create user
    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(user);
    });

    // get user data
    app.get("/user", async (req, res) => {
      const { email } = req.query;
      console.log(email);

      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // create blood donation request
    app.post("/donation-request", async (req, res) => {
      const request = req.body;
      const result = await donationRequests.insertOne(request);
      res.send(result);
    });

    // mongodb end
  } catch (err) {
    console.error(err);
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`🚀 AidEx server listening on port ${port}`);
});
