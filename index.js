const express = require("express");
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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
    // await client.connect();
    // console.log("✅ Successfully connected to MongoDB!");

    const AidExDB = client.db("AidExDB");
    const usersCollection = AidExDB.collection("usersCollection");
    const donationRequests = AidExDB.collection("donationRequests");
    const fundsCollection = AidExDB.collection("fundsCollection");

    // create user
    app.post("/user", async (req, res) => {
      const user = req.body;
      const result = await usersCollection.insertOne(user);
      res.send(result);
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

      const requester = await usersCollection.findOne({
        email: req.token_email,
      });

      if (requester.status !== "Active") {
        return res
          .status(403)
          .send({ message: "You are blocked and can't make a request." });
      }
      const result = await donationRequests.insertOne(request);
      res.send(result);
    });

    // get all pending donation request
    app.get("/pendingRequests", async (req, res) => {
      const result = await donationRequests
        .find({ status: "Pending" })
        .sort({ requested_at: -1 })
        .toArray();

      res.send(result);
    });

    // search donor
    app.get("/search-donor", async (req, res) => {
      const { bloodGroup, district, upazila } = req.query;

      if (!bloodGroup || !district || !upazila) {
        return res.status(400).end();
      }

      const query = {
        role: "Donor",
        bloodGroup,
        district,
        upazila,
      };

      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // stripe payment system integrate
    app.post(
      "/payment-checkout-session",
      verifyFireBaseToken,
      async (req, res) => {
        const { amount, email, name, avatar } = req.body;

        if (!amount || amount <= 0 || !email) {
          return res.status(400).send({ message: "Invalid payment info" });
        }

        const session = await stripe.checkout.sessions.create({
          line_items: [
            {
              price_data: {
                currency: "usd",
                product_data: {
                  name: "Give fund to AidEx",
                },
                unit_amount: amount * 100,
              },
              quantity: 1,
            },
          ],
          mode: "payment",
          customer_email: email,
          metadata: { donorName: name, avatar },
          success_url: `${process.env.DOMAIN}/paymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.DOMAIN}/paymentError`,
        });

        res.send({ url: session.url });
      }
    );

    // get payment result
    app.get("/checkout-session", async (req, res) => {
      const { sessionId } = req.query;

      if (!sessionId) {
        return res.status(400).send({ message: "Session ID missing" });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.status(400).send({ message: "Payment not completed" });
      }

      res.send({
        transactionId: session.payment_intent,
        amount: session.amount_total / 100,
        email: session.customer_email,
        donorName: session.metadata?.donorName,
        avatar: session.metadata?.avatar,
      });
    });

    // create funding data
    app.post("/funds", verifyFireBaseToken, async (req, res) => {
      const data = req.body;
      const { transactionId } = data;

      if (!transactionId) {
        return res.status(400).send({ message: "Transaction ID required" });
      }

      const isExist = await fundsCollection.findOne({ transactionId });

      if (isExist) {
        return res.status(409).send({ message: "Donation already saved" });
      }

      const result = await fundsCollection.insertOne(data);
      res.send(result);
    });

    // get all funding data
    app.get("/funds", verifyFireBaseToken, async (req, res) => {
      const result = await fundsCollection
        .find()
        .sort({ fundingDate: -1 })
        .toArray();

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

    // edit donation request
    app.put(
      "/edit-donation-request/:id",
      verifyFireBaseToken,
      async (req, res) => {
        const { id } = req.params;
        const data = req.body;

        const request = await donationRequests.findOne({
          _id: new ObjectId(id),
        });
        const user = await usersCollection.findOne({ email: req.token_email });

        if (
          !request ||
          request.status !== "Pending" ||
          (request.requesterEmail !== req.token_email &&
            !["Admin"].includes(user.role))
        ) {
          return res.status(403).end();
        }

        const updatedData = {
          ...request,
          recipientName: data.recipientName,
          district: data.district,
          upazila: data.upazila,
          hospital: data.hospital,
          address: data.address,
          bloodGroup: data.bloodGroup,
          donationDate: data.donationDate,
          donationTime: data.donationTime,
          message: data.message,
        };

        const result = await donationRequests.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        res.send(result);
      }
    );

    // accept donation request
    app.put("/donation-request/:id", verifyFireBaseToken, async (req, res) => {
      const { id } = req.params;
      const user = await usersCollection.findOne({ email: req.token_email });
      if (!user || user.role !== "Donor") return;

      const request = await donationRequests.findOne({ _id: new ObjectId(id) });
      if (!request || request.status !== "Pending") return;

      const { _id, ...rest } = request;
      const updateDoc = {
        ...rest,
        status: "Inprogress",
        donorName: user.name,
        donorEmail: user.email,
      };

      await donationRequests.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateDoc }
      );

      res.send(updateDoc);
    });

    // update request status
    app.put(
      "/update-request-status/:id",
      verifyFireBaseToken,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;

        const request = await donationRequests.findOne({
          _id: new ObjectId(id),
        });
        const user = await usersCollection.findOne({ email: req.token_email });

        if (!request) return res.status(404).end();

        if (
          (user.role === "Donor" &&
            request.requesterEmail === req.token_email &&
            request.status === "Inprogress") ||
          user.role === "Admin" ||
          user.role === "Volunteer"
        ) {
          await donationRequests.updateOne(
            { _id: new ObjectId(id) },
            { $set: { status } }
          );
          return res.send({ message: "Status updated" });
        }

        res.status(403).end();
      }
    );

    // delete donation request
    app.delete(
      "/donation-request/:id",
      verifyFireBaseToken,
      async (req, res) => {
        const { id } = req.params;

        const request = await donationRequests.findOne({
          _id: new ObjectId(id),
        });
        const user = await usersCollection.findOne({ email: req.token_email });

        if (
          !request ||
          (request.requesterEmail !== req.token_email &&
            !["Admin"].includes(user.role))
        ) {
          return res.status(403).end();
        }

        const result = await donationRequests.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
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

    // get donation request by ID
    app.get("/donation-request/:id", async (req, res) => {
      const { id } = req.params;
      const result = await donationRequests.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    // get all user by admin
    app.get("/allUsers", verifyFireBaseToken, async (req, res) => {
      const email = req.token_email;
      const requester = await usersCollection.findOne({ email });

      if (requester.role === "Admin") {
        const result = await usersCollection.find().toArray();
        return res.send(result);
      }
      res.status(401).send({ message: "Unauthorize Access" });
    });

    // get all request by checking admin
    app.get("/allRequest", verifyFireBaseToken, async (req, res) => {
      const email = req.token_email;
      const requester = await usersCollection.findOne({ email });

      if (requester.role === "Admin" || requester.role === "Volunteer") {
        const result = await donationRequests.find().toArray();
        return res.send(result);
      }
      res.status(401).send({ message: "Unauthorize Access" });
    });

    // get total donor count, total request count and total fund by admin/volunteer
    app.get("/statics", verifyFireBaseToken, async (req, res) => {
      const email = req.token_email;
      const requester = await usersCollection.findOne({ email });

      if (requester.role === "Admin" || requester.role === "Volunteer") {
        const totalUsers = await usersCollection.countDocuments({
          role: "Donor",
        });

        const totalRequests = await donationRequests.countDocuments();

        const fundDocs = await fundsCollection.find().toArray();
        const totalFunds = fundDocs.reduce(
          (sum, item) => sum + (item.amount || 0),
          0
        );

        return res.send({
          totalUsers,
          totalRequests,
          totalFunds,
        });
      }

      res.status(401).send({ message: "Unauthorize Access" });
    });

    // update user status or role by checking admin role
    app.put("/update-user/:id", verifyFireBaseToken, async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;

      const requester = await usersCollection.findOne({
        email: req.token_email,
      });

      if (!requester || requester.role !== "Admin") {
        return res.status(403).send({ message: "Forbidden Access" });
      }

      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      res.send(result);
    });

    // ------------------------------//
  } catch (err) {
    console.error(err);
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`AidEx server listening on port ${port}`);
});
