const express = require("express");
const { futimesSync } = require("fs");
const mongoose = require("mongoose");
const path = require("path");
if(process.env.NODE_ENV != "production") {
    require('dotenv').config();
}
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcryptjs'); 
const session = require('express-session');
const moment = require('moment-timezone');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));

const dbUrl = process.env.ATLASDB_URL;
console.log(dbUrl);
// const dbUrl = process.env.ATLASDB_URL;

main() 
    .then(() => console.log('Connected to MongoDB!'))
  .catch(err => console.error('Error connecting to MongoDB:', err));


async function main() {
    mongoose.connect(dbUrl);
}
    

// Passport configuration, routes, and other middleware should follow...


// mongoose.connect('mongodb://127.0.0.1:27017/minorgnits')
// .then(() => console.log('Connected to MongoDB!'))
// .catch(err => console.error('Error connecting to MongoDB:', err));


app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: false
}));

app.use(passport.initialize());
app.use(passport.session());

// const studentSchema = new mongoose.Schema({
//     studentId: { type: String, required: true },
//     booksTaken: [{ type: String, default: [] }]
// });

const bookSchema = new mongoose.Schema({
    bookId: { type: String, required: true },
    copiesAvailable: { type: Number, default: 50 }
});

const transactionSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    bookId: { type: String },
    transactionType: { type: String, required: true, enum: ['borrow', 'return'] },
    timestamp: { type: Date, default: Date.now },
    isSuccess: {
        type: Boolean,
        required: false  // or false depending on your schema
    }, // Ensure this is correctly defined
    isPending: { type: Boolean, default: true }
});


const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    booksTaken: [{ type: String, default: [] }],
    booksTakenCount: { type: Number, default: 0 },
    transactionHistory: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }]
});


const User = mongoose.model('User', userSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);
const Book = mongoose.model('Book', bookSchema);

passport.use(new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return done(null, false, { message: 'Incorrect email.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return done(null, false, { message: 'Incorrect password.' });
        }

        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next(); // Proceed to next middleware or route handler
    }
    res.redirect('/login'); // Redirect to login if not authenticated
}

app.get("/", (req, res) => {
    res.send("Hi, I'm a middleware.");
});

app.get("/home", isAuthenticated, async (req, res) => {
    try {
        const transactions = await Transaction.find({ userId: req.user.name }).sort({ timestamp: -1 });
        const latestTransaction = transactions.length > 0 ? transactions[0] : null;
        const transactionsIST = transactions.map(transaction => ({
            ...transaction.toObject(),
            timestamp: moment(transaction.timestamp).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss')
        }));
        res.render("userpage.ejs", {
            user: req.user,
            latestTransaction: latestTransaction,
            transactions: transactions,
            booksTakenCount: req.user.booksTakenCount,
            booksTaken: req.user.booksTaken 
        });
    } catch (err) {
        console.error("Error fetching transactions:", err);
        res.status(500).send("Error fetching transactions");
    }
});

app.get("/signup", (req, res) => {
    res.render("signup.ejs");
});

app.get("/checkin", (req, res) => {
    res.render("checkin.ejs");
});

app.get("/login", (req, res) => {
    res.render("login.ejs");
});

app.get("/showbooks",isAuthenticated,async (req,res) => {
    const books = await Book.find({});
    res.render("showbooks.ejs",{books});
})

app.get("/main", async (req, res) => {
    try {
        // Fetch all books from the database
        // const books = await Book.find({});
        const loggedIn = req.isAuthenticated();
        
        // Render the index.ejs view and pass the books data to it
        res.render("index.ejs", {  loggedIn  });
    } catch (error) {
        console.error("Error fetching books:", error);
        res.status(500).send("Error fetching books");
    }
});


// Handle initial transaction submission
app.post("/api/transactions", isAuthenticated, async (req, res) => {
    try {
        const { action, userId } = req.body;

        if (!action) {
            return res.status(400).json({ error: 'Missing action' });
        }

        let success = false;
        let message = '';

        createTransaction(userId, -88, action,true, true, 'created');
        console.log(message);
        res.status(200).json({ message });

    } catch (error) {
        console.error('Error processing initial transaction:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Handle second request from Hopscotch (or other source) to provide bookId
app.post("/api/completeTransaction", async (req, res) => {
    try {
        const { bookId } = req.body;

        if (!bookId) {
            return res.status(400).json({ error: 'Missing bookId' });
        }

        const transaction = await Transaction.findOne({ 
            userId: req.user.name,
            isPending: true,
            timestamp: { $gte: new Date(Date.now() - 1 * 60 * 1000) } // Check transactions within the last 2 minutes
        }).sort({ timestamp: -1 }).exec();
        if (!transaction) {
            createTransaction(req.user.name, bookId, 'borrow', false, false, 'No transaction');
            return res.status(200).json({ ok: 'Transaction not found or already completed' });
        }

        const userId = transaction.userId;
        let success = false;

        if (transaction.transactionType === 'borrow') {
            const result = await borrowBook(userId, bookId);
            success = result.success;
        } else if (transaction.transactionType === 'return') {
            const result = await returnBook(userId, bookId);
            success = result.success;
        } else {
            return res.status(400).json({ error: 'Invalid action' });
        }

        transaction.isSuccess = success;
        transaction.isPending = false;
        transaction.bookId = bookId;
        await transaction.save();

        const message = success ? `Transaction completed successfully for book (${bookId})` : `Failed to complete transaction for book (${bookId})`;

        console.log(message);
        res.status(200).json({ message });

    } catch (error) {
        console.error('Error completing transaction:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});


async function borrowBook(userId, bookId) {
    try {
        const user = await User.findOne({ name: userId });
        const book = await Book.findOne({ bookId });

        if (!user || !book) {
            throw new Error('Invalid user or book');
        }

        if (book.copiesAvailable <= 0) {
            throw new Error('No copies available');
        }
        if (user.booksTaken.includes(bookId)) {
            throw new Error('Already have it');
        }

        // Update user's booksTaken array and booksTakenCount
        user.booksTaken.push(bookId);
        user.booksTakenCount += 1;
        await user.save();

        // Decrease available copies of the book
        book.copiesAvailable -= 1;
        await book.save();

        console.log(`Book (${bookId}) borrowed successfully`);
        createTransaction(userId, bookId, 'borrow', true, true, 'Book borrowed successfully');

        return { success: true, message: `Book (${bookId}) borrowed successfully` };
    } catch (error) {
        console.error('Error borrowing book:', error);
        createTransaction(userId, bookId, 'borrow', false, false, 'Internal Server Error');
        return { success: false, message: 'Internal Server Error' };
    }
}

// Function to handle returning a book
async function returnBook(userId, bookId) {
    try {
        const user = await User.findOne({ name: userId });
        const book = await Book.findOne({ bookId });

        if (!user || !book) {
            throw new Error('Invalid user or book');
        }

        if (!user.booksTaken.includes(bookId)) {
            throw new Error('User did not borrow this book');
        }

        // Remove book from user's list
        user.booksTaken = user.booksTaken.filter(b => b !== bookId);
        user.booksTakenCount -= 1;
        await user.save();

        // Increase available copies of the book
        book.copiesAvailable += 1;
        await book.save();

        console.log(`Book (${bookId}) returned successfully`);
        createTransaction(userId, bookId, 'return', true, true, 'Book returned successfully');

        return { success: true, message: `Book (${bookId}) returned successfully` };
    } catch (error) {
        console.error('Error returning book:', error);
        createTransaction(userId, bookId, 'return', false, false, 'Internal Server Error');
        return { success: false, message: 'Internal Server Error' };
    }
}

async function createTransaction(userId, bookId, transactionType, isPending, isSuccess, message) {
    try {
        const transaction = new Transaction({
            userId,
            bookId,
            transactionType,
            timestamp: new Date(),
            isSuccess, // Ensure isSuccess is a Boolean value
            isPending,
            message // Optional: You can pass a message if needed
        });
        await transaction.save();
    } catch (error) {
        console.error('Error creating transaction:', error);
    }
}

// Signup route
app.post('/signup', async (req, res) => {
    const { name, email, password } = req.body;
    console.log('Form Data:', req.body);
    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({
            name,
            email,
            password: hashedPassword
        });
        await newUser.save();

        res.redirect('/login');
    } catch (error) {
        console.error('Error during user registration:', error);
        res.status(500).send('Error during user registration');
    }
});

// Login route
app.post('/login', (req, res, next) => {
    passport.authenticate('local', (err, user, info) => {
        if (err) { return next(err); }
        if (!user) { return res.redirect('/login'); }
        req.login(user, (err) => {
            if (err) { return next(err); }
            return res.redirect('/home'); // Redirect to home after successful login
        });
    })(req, res, next);
});

// Logout route
app.post('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) {
            console.error('Error logging out:', err);
            return next(err);
        }
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session:', err);
                return next(err);
            }
            res.redirect('/main'); 
        });
    });
});


// Middleware to check if user is authenticated
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        return next(); // Proceed to next middleware or route handler
    }
    res.redirect('/login'); // Redirect to login if not authenticated
}


async function seedBooks() {
    try {
        const booksToAdd = [
            { bookId: 'Data Structures and Algorithms', copiesAvailable: 50 },
            { bookId: 'Cloud Computing', copiesAvailable: 50 },
            { bookId: 'Machine Learning', copiesAvailable: 50 },
            { bookId: 'DBMS', copiesAvailable: 50 },
            { bookId: 'OOPS', copiesAvailable: 50 },
            { bookId: 'OS', copiesAvailable: 50 }
            // Add more books as needed
        ];

        for (let bookData of booksToAdd) {
            const existingBook = await Book.findOne({ bookId: bookData.bookId });

            if (!existingBook) {
                const newBook = new Book({
                    bookId: bookData.bookId,
                    copiesAvailable: bookData.copiesAvailable
                });
                await newBook.save();
                console.log(`Added book "${bookData.bookId}" to the database.`);
            }
        }
    } catch (error) {
        console.error('Error seeding books:', error);
    }
}


async function bbb() {
    await mongoose.connect(dbUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });

    // After connecting to MongoDB, seed the books
    await seedBooks();
}
// bbb();


app.listen(8080, () => {
    console.log("Server listening at port 8080");
});