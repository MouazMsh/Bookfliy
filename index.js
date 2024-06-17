import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import bcrypt from "bcrypt";


const app = express();
const port = 3000;
const saltingRound = 10;
env.config();
const db = new pg.Client({
    user: process.env.PG_USER,
    database: process.env.PG_DATABASE,
    host: process.env.PG_HOST,
    password: process.env.PG_PASSWORD,
    port: process.env.PG_PORT,
});
db.connect();

const apiLink = "https://covers.openlibrary.org/b/isbn/";
let users = [];
let currentUser = [];
let books = [];
let currentUserId = 1;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));

// Getting the book info from database
async function checkBook() {
    const result = await db.query("SELECT * FROM books WHERE books.user_id = $1 ORDER BY read_date",[currentUserId]);
    books = result.rows;
    return books;
};

// Getting a specific user info from database
async function checkUser() {
    const result = await db.query("SELECT * FROM users WHERE id = $1",[currentUserId]);
    currentUser = result.rows;
    return currentUser;
};

// Getting specific book based on the id of the book
async function getSpecificBook(temp) {
    const result = await db.query("SELECT books.title, books.author, books.read_date, books.rating, books.head, books.note, books.src_image FROM books JOIN users ON users.id = books.user_id WHERE books.id = $1",[temp]);
    return result.rows;
};

app.get("/", (req, res) => {
  res.render("homepage.ejs");
});


// Get log out
app.get("/logout", (req,res) => {
  res.redirect("/");
})

// Get Home page 
app.get("/homepage", async (req, res) => {
  const resultUser = await checkUser(); // Getting the current user info [{},{}]
  const resultBook = await checkBook(); // Getting the books [{},{}]
  res.render("index.ejs", {user: resultUser, book: resultBook});
});

// Get register page
app.get("/register", (req, res) => {
    res.render("register.ejs");
});
// Get log in page
app.get("/login", (req, res) => {
    res.render("login.ejs");
});

// post log in
app.post("/login", async (req, res) => {
    const email = req.body.emailLogin;
    const password = req.body.passwordLogin;

    try {
        //Check if the user exists
        const result = await db.query("SELECT * FROM users WHERE email = $1",[email]);
        // User exists
        if (result.rows.length > 0) {
          const user = result.rows[0];
          const storedHashedPassword = user.passwords;
    
          bcrypt.compare(password,storedHashedPassword, async (err, result) => {
            if (err){
              console.log("Error comparing password",err);
            } else {
              if (result) {
                currentUserId = user.id;
                res.redirect("/homepage");   
              } else {
                res.send("Incorrect Password");
              }
            }
          });
        // User does not exist
        } else {
          res.send("User not found");
        }
      } catch (err) {
        console.log(err);
    }
});

// post register
app.post("/register", async (req, res) => {
    const name = req.body.name;
    const email = req.body.email;
    const password = req.body.password;
    const role = "User"

    try {
        //Check if the user exists
        const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
        // User exists
        if (checkResult.rows.length > 0) {
          res.send("Email already exists. Try logging in.");
        // user does not exists, we add it to db.
        } else {
          bcrypt.hash(password, saltingRound , async (err, hash) => {
            if (err) {
              console.log("Error handling password",err);
            } else {
              const result = await db.query("INSERT INTO users (name, email, passwords, roles) VALUES ($1, $2, $3, $4)", [name, email, hash, role]);
              res.redirect("/login");
            }
          })
        }
      } catch (err) {
        console.log(err);
      }
});

// Get add Book page
app.get("/newbook", async (req, res) => {
    res.render("book.ejs", {user: currentUser});
});

// Get forgot password page
app.get("/forgot", (req, res) => {
  res.render("forgotpass.ejs");
});


// Get Book Dashboard page
app.get("/bookdash", async (req,res) => {
    res.render("bookdashboard.ejs", {user: currentUser, book: books});
});


// Get 'see my notes' page
app.get("/view/:id", async (req,res) => {
    const ids = parseInt(req.params.id);
    const result = await getSpecificBook(ids);
    res.render("viewNote.ejs", {user: currentUser, book: result});
});

// Get edit page notes
app.get("/notes", async (req,res) => {
    res.render("editnote.ejs",{user: currentUser, book: books});
});


// Post Add Book
app.post("/new", async (req,res) => {
    const title = req.body.title;
    const author = req.body.author;
    const date = req.body.datecom;
    const rating = parseInt(req.body.rating);
    const summrize = req.body.summrize;
    const isbn = apiLink + `${req.body.isbn}` + "-L.jpg" ;
    const notes = req.body.notes;
    await db.query("INSERT INTO books (title, author, read_date, rating, head, note, src_image, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",[title, author, date, rating, summrize, notes, isbn, currentUserId]);
    res.redirect("/homepage");   
});

// Post forgot password
app.post("/forgotpass", async (req,res) => {
  const email = req.body.emailForgot;
  const newPass = req.body.newPass;

  try {
    //Check if the user exists
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [email]);
    // User exists
    if (checkResult.rows.length > 0) {
      bcrypt.hash(newPass, saltingRound , async (err, hash) => {
        if (err) {
          console.log("Error handling password",err);
        } else {
          const result = await db.query("UPDATE users SET passwords = $1 WHERE email = $2",[hash,email]);
          res.redirect("/login");
        }
      })
    // user does not exists, we add it to db.
    } else {
      res.send("User is not existed, try Register");
    }
  } catch (err) {
    console.log(err);
  }
});

// Post Delete book
app.post("/deletebook", async (req,res) => {
    const bookName = req.body.selectbookname;
    const result = await db.query("DELETE FROM books WHERE title = $1",[bookName]);
    res.redirect("/homepage");   
});

// Post Edit Notes
app.post("/editnotes", async (req,res) => {
    const bookNameEdit = req.body.selectbooknameedit;
    const newNotes = req.body.editbooknotes;
    const result = await db.query("UPDATE books SET note = $1 WHERE title = $2",[newNotes, bookNameEdit]);
    res.redirect("/homepage");   
});

// Sort by Newness
app.get("/newest", async (req,res) => {
    const result = await db.query("SELECT * FROM books WHERE books.user_id = $1 ORDER BY read_date DESC",[currentUserId]);
    res.render("index.ejs", {user: currentUser, book: result.rows});
});

// Sort by Title
app.get("/title", async (req,res) => {
    const result = await db.query("SELECT * FROM books WHERE books.user_id = $1 ORDER BY title",[currentUserId]);
    res.render("index.ejs", {user: currentUser, book: result.rows});
});

// Sort by Recommendation
app.get("/recommendation", async (req,res) => {
    const result = await db.query("SELECT * FROM books WHERE books.user_id = $1 ORDER BY rating DESC",[currentUserId]);
    res.render("index.ejs", {user: currentUser, book: result.rows});
});

app.listen(port, () => {
    console.log(`Server is listening to port ${port}`);
});

