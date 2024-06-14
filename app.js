const express = require("express");
const { futimesSync } = require("fs");
const mongoose = require("mongoose");
const path = require("path");
if(process.env.NODE_ENV != "production") {
    require('dotenv').config();
}
console.log(process.env.NODE_ENV);
import('node-fetch').then(nodeFetch => {
    const fetch = nodeFetch.default;
    // Your code using fetch goes here
}).catch(error => {
    console.error('Error importing node-fetch:', error);
});
const app = express();

app.use(express.json()); 

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/views"));

// mongoose.connect('mongodb://127.0.0.1:27017/minorgnits')
//   .then(() => console.log('Connected to MongoDB!'))
//   .catch(err => console.error('Error connecting to MongoDB:', err));

const dbUrl = process.env.ATLASDB_URL;

main() 
    .then(() => console.log('Connected to MongoDB!'))
  .catch(err => console.error('Error connecting to MongoDB:', err));


async function main() {
    mongoose.connect(dbUrl);
}




const studentSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    bookId: { type: String, default: null }
});

const bookSchema = new mongoose.Schema({
    bookId: { type: String, required: true },
    available: { type: Boolean, default: true }
});
  
const transactionSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    bookId: { type: String, required: true },
    transactionType: { type: String, required: true, enum: ['borrow', 'return'] },
    timestamp: { type: Date, default: Date.now },
    isSuccess: { type: Boolean, default: false }
});

const Transaction = mongoose.model('Transaction', transactionSchema);
const Book = mongoose.model('Book', bookSchema);
const Student = mongoose.model('Student', studentSchema);
  
app.get("/",(req,res) => {
    res.send("Hi, I'm a middleware.");
});

app.get("/home", async (req, res) => {
    try {
        const latestTransaction = await Transaction.findOne().sort({ timestamp: -1 });

        if (latestTransaction) {
            let status;
            if (latestTransaction.transactionType === 'borrow') {
                status = latestTransaction.isSuccess ? 'successfully borrowed the book ' : 'failed to borrow the book ';
            } else {
                status = latestTransaction.isSuccess ? 'successfully returned the book ' : 'failed to return the book ';
            }
            res.render("index.ejs", { 
                latestTransaction: latestTransaction, 
                status: status 
            });
        } else {
            res.render("index.ejs", { 
                latestTransaction: null, 
                status: 'No transactions found.' 
            });
        }
    } catch (error) {
        console.error('Error fetching latest transaction:', error);
        res.status(500).send('Internal server error');
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

app.post("/api/transactions", async (req, res) => {
    try {
        const { studentId, bookId, transactionType } = req.body;
        console.log(req.body);

        if (!studentId || !bookId || typeof transactionType !== 'number') {
            console.log('Invalid input data');
            return res.status(400).json({ error: 'Invalid input data' });
        }

        let message = '';

        if (transactionType === 0) {
            const success = await borrowBook(studentId, bookId);
            message = success ? 'Book borrowed successfully' : 'Failed to borrow the book';
        } else if (transactionType === 1) {
            const success = await returnBook(studentId, bookId);
            message = success ? 'Book returned successfully' : 'Failed to return the book';
        } else {
            console.log('Invalid transaction type');
            return res.status(400).json({ error: 'Invalid transaction type' });
        }

        console.log(message);
        return res.status(200).json({ message });
    } catch (error) {
        console.error('Error processing transaction:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

async function borrowBook(studentId, bookId) {
    try {
        const student = await Student.findOne({ studentId });
        const book = await Book.findOne({ bookId });

        if (!student || !book) {
            console.error('Failed to borrow the book: Invalid student or book data');
            createTransaction(studentId, bookId, 'borrow', false);
            return false;
        }

        if (!book.available || student.bookId) {
            console.error('Failed to borrow the book: The book is not available or student already has a book checked out');
            createTransaction(studentId, bookId, 'borrow', false);
            return false;
        }

        student.bookId = bookId;
        await student.save();

        book.available = false;
        await book.save();

        createTransaction(studentId, bookId, 'borrow', true);
        return true;
    } catch (error) {
        console.error('Error borrowing book:', error);
        createTransaction(studentId, bookId, 'borrow', false);
        return false;
    }
}

async function returnBook(studentId, bookId) {
    try {
        const student = await Student.findOne({ studentId });
        const book = await Book.findOne({ bookId });

        if (!student || !book || student.bookId !== bookId || book.available) {
            console.error('Failed to return the book: Invalid student or book data, or book is already available, or student does not have this book');
            createTransaction(studentId, bookId, 'return', false);
            return false;
        }

        book.available = true;
        await book.save();

        student.bookId = null;
        await student.save();

        createTransaction(studentId, bookId, 'return', true);
        return true;
    } catch (error) {
        console.error('Error returning book:', error);
        createTransaction(studentId, bookId, 'return', false);
        return false;
    }
}

async function createTransaction(studentId, bookId, transactionType, isSuccess) {
    try {
        const transaction = new Transaction({
            studentId,
            bookId,
            transactionType,
            timestamp: new Date(),
            isSuccess
        });
        await transaction.save();
    } catch (error) {
        console.error('Error creating transaction:', error);
    }
}

async function sendTransactionData() {
    const transactionData = {
        studentId: 'student1',
        bookId: 'book1',
        transactionType: 1 // 0 for borrowing, 1 for returning
    };

    try {
        const response = await fetch('http://localhost:8080/api/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(transactionData)
        });

        const responseData = await response.json();
        if (response.ok) {
            console.log(responseData.message); // Log the success message
        } else {
            console.error('Error:', responseData.error); // Log the error message
        }
    } catch (error) {
        console.error('Error sending transaction data:', error);
    }
}

// sendTransactionData();


app.listen(8080, () => {
    console.log("Server listening at port 8080");
});
