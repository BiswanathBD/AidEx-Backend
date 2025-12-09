const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

const app = express();
const port = process.env.PORT || 3000;

// middleWare
app.use(express.json());
app.use(cors());

// firebase verification
const decoded = Buffer.from(process.env.FIREBASE_API_KEY, "base64").toString(
  "utf8"
);
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const verifyFireBaseToken = async (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "Unauthorize Access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  if (!token) {
    return res.status(401).send({ message: "Unauthorize Access" });
  }

  try {
    const authInfo = await admin.auth().verifyIdToken(token);
    req.token_email = authInfo.email;
    console.log("firebase verified");
    next();
  } catch {
    console.log("token not verified");
    return res.status(401).send({ message: "Unauthorize Access" });
  }
};

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
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // create blood donation request
    app.post("/donation-request", verifyFireBaseToken, async (req, res) => {
      const request = req.body;
      if (request.requesterEmail !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const result = await donationRequests.insertOne(request);
      res.send(result);
    });

    // get my donation request
    app.get("/donation-request", verifyFireBaseToken, async (req, res) => {
      const { email } = req.query;

      if (email !== req.token_email) {
        return res.status(403).send({ message: "Forbidden Access" });
      }
      const result = await donationRequests
        .find({ requesterEmail: email })
        .sort({ requested_at: -1 })
        .toArray();
      res.send(result);
    });

    // delete donation request
    app.delete(
      "/donation-request/:id",
      verifyFireBaseToken,
      async (req, res) => {
        const { id } = req.params;

        const query = { _id: new ObjectId(id) };
        const findData = await donationRequests.findOne(query);

        if (findData.requesterEmail === req.token_email) {
          const result = donationRequests.deleteOne(query);
          res.send(result);
        }
      }
    );

    // update user profile
    app.put("/user/:email", verifyFireBaseToken, async (req, res) => {
      const { email } = req.params;
      const updatedData = req.body;

      if (email !== req.token_email)
        return res.status(403).send({ message: "Forbidden Access" });

      const result = await usersCollection.findOneAndUpdate(
        { email },
        { $set: updatedData }
      );
      res.send(result.value);
    });

    // mongodb end
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`AidEx server listening on port ${port}`);
});
