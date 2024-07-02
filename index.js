import express from "express";
import bodyParser from "body-parser";
import pg from "pg";
import env from "dotenv";
import bcrypt from "bcrypt";
import session from "express-session";

const app = express();
const port = process.env.PORT || 3000;
const saltingRound = 10;
env.config();
const db = new pg.Client({
  user: process.env.PG_USER,
  database: process.env.PG_DATABASE,
  host: process.env.PG_HOST,
  password: process.env.PG_PASSWORD,
  port: process.env.PG_PORT,
  ssl: true,
});
db.connect();

const apiLink = "https://covers.openlibrary.org/b/isbn/";
//let currentUserId;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static("public"));
app.use(express.json());
app.use(errorHandler);
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
  })
);

// Error handling middleware
function errorHandler(err, req, res, next) {
  console.error(err.stack);
  res.status(err.status || 500).json({
    message: err.message || "Internal Server Error",
  });
}

// Getting the book info for current user from database
async function checkBook(req) {
  try {
    const result = await db.query(
      "SELECT * FROM books WHERE books.user_id = $1 ORDER BY read_date",
      [req.session.currentUserId]
    );
    req.session.books = result.rows;
    return req.session.books;
  } catch (err) {
    console.error("Error in checkBook:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

// Get users's friends id
async function checkFriend(req) {
  try {
    const result = await db.query(
      "SELECT friend_with FROM friends WHERE user_id = $1",
      [req.session.currentUserId]
    );
    return result.rows;
  } catch (err) {
    console.error("Error in checkFriend:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

// Get all books from the db
async function getAllBooks(req) {
  try {
    const allBook = await db.query(
      "SELECT title, author, read_date, rating, head, src_image, user_id FROM books"
    );
    req.session.allBooks = allBook.rows;
    return req.session.allBooks;
  } catch (err) {
    console.error("Error in getAllBooks:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

// Get books that belongs to the friends of user
async function checkFriendsBook(req) {
  try {
    const friends = await checkFriend(req);
    const dbBooks = await getAllBooks(req);
    const filterd = dbBooks.filter((book) =>
      friends.find((x) => x.friend_with === book.user_id)
    );
    return filterd;
  } catch (err) {
    console.error("Error in checkFriendsBook:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

// Getting a current user info from database
async function checkUser(req) {
  try {
    const result = await db.query("SELECT * FROM users WHERE id = $1", [
      req.session.currentUserId,
    ]);
    req.session.currentUser = result.rows;
    return req.session.currentUser;
  } catch (err) {
    console.error("Error in checkUser:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

// Getting all the users data
async function checkAllUsers(req) {
  try {
    const result = await db.query(
      "SELECT id, name, username, friend_num FROM users"
    );
    req.session.users = result.rows;
    return req.session.users;
  } catch (err) {
    console.error("Error in checkAllUsers:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

// Getting specific book by the id of the book
async function getSpecificBook(temp) {
  try {
    const result = await db.query(
      "SELECT books.title, books.author, books.read_date, books.rating, books.head, books.note, books.src_image FROM books JOIN users ON users.id = books.user_id WHERE books.id = $1",
      [temp]
    );
    return result.rows;
  } catch (err) {
    console.error("Error in getSpecificBook:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

// Getting the Notification for the current user
async function checkNotification(req) {
  try {
    const result = await db.query(
      "SELECT from_user FROM notification WHERE to_user = $1",
      [req.session.currentUserId]
    );
    const allUsers = await checkAllUsers(req);
    const filterd = allUsers.filter((user) =>
      result.rows.find((x) => x.from_user === user.id)
    );
    req.session.notification = filterd;
    return req.session.notification;
  } catch (err) {
    console.error("Error in checkNotification:", err);
    err.status = 500; // set a custom status code
    throw err; // Rethrow the error to be caught by the route handler
  }
}

app.get("/", (req, res) => {
  res.render("homepage.ejs");
});

// Get log out
app.get("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) {
      next(err);
    }
    res.redirect("/");
  });
});

// Get profile page
app.get("/profile", async (req, res, next) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  try {
    const resultUser = await checkUser(req); // Getting the current user info [{},{}]
    const friends = await checkFriend(req);
    // Add name value to every item in filtered
    const addedNameFiltered = friends.map((friend) => {
      // Find the user whose id matches the user_id in the book
      const user = req.session.users.find((user) => user.id === friend.friend_with);
      // Return a new object combining the book's properties with the user's name
      return {
        ...friend,
        name: user ? user.name : null, // Add a null check for safety
      };
    });
    res.render("profile.ejs", {
      user: resultUser,
      notification: req.session.notification,
      friends: addedNameFiltered,
      formSubmitted: formSubmitted,
      message: message,
    });
  } catch (err) {
    next(err);
  }
});

// Remove friend from db
app.post("/removefriends", async (req, res, next) => {
  const friendId = parseInt(req.body.friendToRemove);
  try {
    // Delete values from the friends table
    await db.query(
      "DELETE FROM friends WHERE user_id = $1 AND friend_with = $2",
      [req.session.currentUserId, friendId]
    );
    await db.query(
      "DELETE FROM friends WHERE user_id = $1 AND friend_with = $2",
      [friendId, req.session.currentUserId]
    );
    // update the friend number in users table
    await db.query(
      "UPDATE users SET friend_num = friend_num - 1 WHERE id = $1",
      [req.session.currentUserId]
    );
    await db.query(
      "UPDATE users SET friend_num = friend_num - 1 WHERE id = $1",
      [friendId]
    );
    // Set a session flag and message
    req.session.formSubmitted = "Remove Friends";
    req.session.message = "Removed Successfully.";
    res.redirect("/profile");
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// post add friend
app.post("/addfriends", async (req, res, next) => {
  const userNameFriend = req.body.addfriend;

  try {
    // Check if the username is exist
    const result = await db.query("SELECT id FROM users WHERE username = $1", [
      userNameFriend,
    ]);
    // username exists
    if (result.rows.length > 0) {
      const userIdSent = parseInt(result.rows[0].id); // Get the user id that received the request
      // Check if the added user is the same current user
      if (userIdSent === req.session.currentUserId) {
        // Set a session flag and message
        req.session.formSubmitted = "add Friends";
        req.session.message = "You can not add yourself :(";
        res.redirect("/profile");
        // added user is not the same current user
      } else {
        // Check if the added user is already a friend
        const checkIfUserIsFriend = await db.query(
          "SELECT * FROM friends WHERE user_id = $1 AND friend_with = $2",
          [req.session.currentUserId, userIdSent]
        );
        // User is in friend list
        if (checkIfUserIsFriend.rows.length > 0) {
          // Set a session flag and message
          req.session.formSubmitted = "add Friends";
          req.session.message = "User is already your friend";
          res.redirect("/profile");
        } else {
          const checkIfRequestSent = await db.query(
            "SELECT to_user FROM notification WHERE from_user = $1",
            [req.session.currentUserId]
          );
          // Check if the arr is empty and send a request
          if (checkIfRequestSent.rows.length === 0) {
            await db.query(
              "INSERT INTO notification (from_user, to_user) VALUES ($1, $2)",
              [req.session.currentUserId, userIdSent]
            );
            // Set a session flag and message
            req.session.formSubmitted = "add Friends";
            req.session.message = "Friend Request has been sent.";
            res.redirect("/profile");
          } else {
            const isSent = checkIfRequestSent.rows.filter(
              (item) => item.to_user === userIdSent
            );
            // Check if the request has been sent before
            if (isSent.length > 0) {
              // Set a session flag and message
              req.session.formSubmitted = "Resuest sent before";
              req.session.message = "Friend Request has been sent before.";
              res.redirect("/profile");
              // request has not been sent
            } else {
              await db.query(
                "INSERT INTO notification (from_user, to_user) VALUES ($1, $2)",
                [req.session.currentUserId, userIdSent]
              );
              // Set a session flag and message
              req.session.formSubmitted = "add Friends";
              req.session.message = "Friend Request has been sent.";
              res.redirect("/profile");
            }
          }
        }
      }
      // username does not exist
    } else {
      // Set a session flag and message
      req.session.formSubmitted = "add Friends";
      req.session.message =
        "Username is not found, be careful with capital letter.";
      res.redirect("/profile");
    }
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// Remove friend request
app.post("/removerequest", async (req, res, next) => {
  const passedId = parseInt(req.body.remove);
  try {
    await db.query(
      "DELETE FROM notification WHERE to_user = $1 AND from_user = $2",
      [req.session.currentUserId, passedId]
    );
    res.redirect("/homepage");
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// add friend request
app.post("/acceptrequest", async (req, res, next) => {
  const passedId = parseInt(req.body.add);
  try {
    // insert values into the friends table
    await db.query(
      "INSERT INTO friends (user_id, friend_with) VALUES ($1, $2)",
      [req.session.currentUserId, passedId]
    );
    await db.query(
      "INSERT INTO friends (user_id, friend_with) VALUES ($1, $2)",
      [passedId, req.session.currentUserId]
    );
    // update the friend number in users table
    await db.query(
      "UPDATE users SET friend_num = friend_num + 1 WHERE id = $1",
      [req.session.currentUserId]
    );
    await db.query(
      "UPDATE users SET friend_num = friend_num + 1 WHERE id = $1",
      [passedId]
    );
    // delete the notification from the table
    await db.query(
      "DELETE FROM notification WHERE to_user = $1 AND from_user = $2",
      [req.session.currentUserId, passedId]
    );
    res.redirect("/homepage");
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// Get timeline page
app.get("/timeline", async (req, res, next) => {
  try {
    const friendNum = await checkFriend(req);
    const filterd = await checkFriendsBook(req);
    // Add name value to every item in filtered
    const addedNameFiltered = filterd.map((book) => {
      // Find the user whose id matches the user_id in the book
      const user = req.session.users.find((user) => user.id === book.user_id);
      // Return a new object combining the book's properties with the user's name
      return {
        ...book,
        name: user ? user.name : null, // Add a null check for safety
      };
    });
    res.render("timeline.ejs", {
      user: req.session.currentUser,
      book: addedNameFiltered,
      notification: req.session.notification,
      friendsNumber: friendNum,
    });
  } catch (err) {
    next(err);
  }
});

// Get Home page
app.get("/homepage", async (req, res, next) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  try {
    const resultUser = await checkUser(req); // Getting the current user info [{},{}]
    const resultBook = await checkBook(req); // Getting the books [{},{}]
    const resultNotification = await checkNotification(req); // Getting the notification [{}, {}]
    res.render("index.ejs", {
      user: resultUser,
      book: resultBook,
      notification: resultNotification,
      formSubmitted: formSubmitted,
      message: message,
    });
  } catch (err) {
    next(err);
  }
});

// Get register page
app.get("/register", (req, res) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  res.render("register.ejs", {
    formSubmitted: formSubmitted,
    message: message,
  });
});

// Get log in page
app.get("/login", (req, res) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  res.render("login.ejs", { formSubmitted: formSubmitted, message: message });
});

// post log in
app.post("/login", async (req, res, next) => {
  const email = req.body.emailLogin;
  const password = req.body.passwordLogin;

  try {
    //Check if the user exists
    const result = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    // User exists
    if (result.rows.length > 0) {
      const user = result.rows[0];
      const storedHashedPassword = user.passwords;

      bcrypt.compare(password, storedHashedPassword, async (err, result) => {
        if (err) {
          console.log("Error comparing password", err);
        } else {
          if (result) {
            req.session.currentUserId = user.id;
            res.redirect("/homepage");
          } else {
            // Set a session flag and message
            req.session.formSubmitted = "Incorrect Password";
            req.session.message = "Incorrect Password";
            res.redirect("/login");
          }
        }
      });
      // User does not exist
    } else {
      // Set a session flag and message
      req.session.formSubmitted = "Email not registered";
      req.session.message = "Email is not registered";
      res.redirect("/login");
    }
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// post register
app.post("/register", async (req, res, next) => {
  const name = req.body.name;
  const email = req.body.email.trim();
  const password = req.body.password;
  const username = req.body.username.trim();
  const role = "User";

  try {
    //Check if the user exists
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const checkUsername = await db.query(
      "SELECT * FROM users WHERE username = $1",
      [username]
    );
    // User exists
    if (checkResult.rows.length > 0) {
      // Set a session flag and message
      req.session.formSubmitted = "Email Exists";
      req.session.message = "Email already exists. Try logging in.";
      res.redirect("/register");
      // Check if the username is taken or not
    } else if (checkUsername.rows.length > 0) {
      // Set a session flag and message
      req.session.formSubmitted = "Username Taken";
      req.session.message = "Username already taken. Choose another one.";
      res.redirect("/register");
    }
    // user does not exists, we add it to db.
    else {
      bcrypt.hash(password, saltingRound, async (err, hash) => {
        if (err) {
          next(err); // Pass the error to the error handler
        } else {
          const result = await db.query(
            "INSERT INTO users (name, email, passwords, username, roles, friend_num) VALUES ($1, $2, $3, $4, $5, $6)",
            [name, email, hash, username, role, 0]
          );
          // Set a session flag and message
          req.session.formSubmitted = "User Created";
          req.session.message = "New account has created you can log in.";
          res.redirect("/login");
        }
      });
    }
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// Get add Book page
app.get("/newbook", async (req, res) => {
  res.render("book.ejs", { user: req.session.currentUser, notification: req.session.notification });
});

// Get forgot password page
app.get("/forgot", (req, res) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  res.render("forgotpass.ejs", {
    formSubmitted: formSubmitted,
    message: message,
  });
});

// Get Book Dashboard page
app.get("/bookdash", async (req, res) => {
  res.render("bookdashboard.ejs", {
    user: req.session.currentUser,
    book: req.session.books,
    notification: req.session.notification,
  });
});

// Get 'see my notes' page
app.get("/view/:id", async (req, res, next) => {
  const ids = parseInt(req.params.id);
  try {
    const result = await getSpecificBook(ids);
    res.render("viewNote.ejs", {
      user: req.session.currentUser,
      book: result,
      notification: req.session.notification,
    });
  } catch (err) {
    next(err);
  }
});

// Get edit page notes
app.get("/notes", async (req, res) => {
  res.render("editnote.ejs", {
    user: req.session.currentUser,
    book: req.session.books,
    notification: req.session.notification,
  });
});

// Post Add Book
app.post("/new", async (req, res, next) => {
  const title = req.body.title;
  const author = req.body.author;
  const date = req.body.datecom;
  const rating = parseInt(req.body.rating);
  const summrize = req.body.summrize;
  const isbn = apiLink + `${req.body.isbn}` + "-L.jpg";
  const notes = req.body.notes;
  try {
    await db.query(
      "INSERT INTO books (title, author, read_date, rating, head, note, src_image, user_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [title, author, date, rating, summrize, notes, isbn, req.session.currentUserId]
    );
    // Set a session flag and message
    req.session.formSubmitted = "add new book";
    req.session.message = "Your new book has been added";
    res.redirect("/homepage");
  } catch (err) {
    next(err);
  }
});

// Post forgot password
app.post("/forgotpass", async (req, res, next) => {
  const email = req.body.emailForgot;
  const newPass = req.body.newPass;

  try {
    //Check if the user exists
    const checkResult = await db.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    // User exists
    if (checkResult.rows.length > 0) {
      bcrypt.hash(newPass, saltingRound, async (err, hash) => {
        if (err) {
          next(err);
        } else {
          const result = await db.query(
            "UPDATE users SET passwords = $1 WHERE email = $2",
            [hash, email]
          );
          // Set a session flag and message
          req.session.formSubmitted = "New Password";
          req.session.message = "Your password has been reset";
          res.redirect("/login");
        }
      });
      // user does not exists, we add it to db.
    } else {
      // Set a session flag and message
      req.session.formSubmitted = "Email not registered";
      req.session.message = "Email is not registered";
      res.redirect("/forgot");
    }
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// Post Delete book
app.post("/deletebook", async (req, res, next) => {
  const bookName = req.body.selectbookname;
  try {
    const result = await db.query("DELETE FROM books WHERE title = $1", [
      bookName,
    ]);
    // Set a session flag and message
    req.session.formSubmitted = "Delete book";
    req.session.message = "Book deleted Successfully.";
    res.redirect("/homepage");
  } catch (err) {
    next(err);
  }
});

// Post Edit Notes
app.post("/editnotes", async (req, res, next) => {
  const bookNameEdit = req.body.selectbooknameedit;
  const newNotes = req.body.editbooknotes;
  try {
    const result = await db.query(
      "UPDATE books SET note = $1 WHERE title = $2",
      [newNotes, bookNameEdit]
    );
    // Set a session flag and message
    req.session.formSubmitted = "Edit note";
    req.session.message = "Notes has been updated.";
    res.redirect("/homepage");
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// Sort by Newness
app.get("/newest", async (req, res, next) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  try {
    const result = await db.query(
      "SELECT * FROM books WHERE books.user_id = $1 ORDER BY read_date DESC",
      [req.session.currentUserId]
    );
    res.render("index.ejs", {
      user: req.session.currentUser,
      book: result.rows,
      notification: req.session.notification,
      formSubmitted: formSubmitted,
      message: message,
    });
  } catch (err) {
    next(err);
  }
});

// Sort by Title
app.get("/title", async (req, res, next) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  try {
    const result = await db.query(
      "SELECT * FROM books WHERE books.user_id = $1 ORDER BY title",
      [req.session.currentUserId]
    );
    res.render("index.ejs", {
      user: req.session.currentUser,
      book: result.rows,
      notification: req.session.notification,
      formSubmitted: formSubmitted,
      message: message,
    });
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

// Sort by Recommendation
app.get("/recommendation", async (req, res, next) => {
  const formSubmitted = req.session.formSubmitted;
  const message = req.session.message;
  // Clear the session flags
  req.session.formSubmitted = null;
  req.session.message = null;
  try {
    const result = await db.query(
      "SELECT * FROM books WHERE books.user_id = $1 ORDER BY rating DESC",
      [req.session.currentUserId]
    );
    res.render("index.ejs", {
      user: req.session.currentUser,
      book: result.rows,
      notification: req.session.notification,
      formSubmitted: formSubmitted,
      message: message,
    });
  } catch (err) {
    next(err); // Pass the error to the error handler
  }
});

app.listen(port, () => {
  console.log(`Server is listening to port ${port}`);
});
