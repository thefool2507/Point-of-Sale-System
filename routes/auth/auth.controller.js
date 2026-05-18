const { db } = require("../../db/db");
const bcrypt = require("bcrypt");
const { LOG_LEVELS } = require("../../helpers/log");
const { activityLogger } = require("../../middlewares/activityLogger");

const SALT_ROUNDS = 10;

const getLoginPage = (req, res) => {
  res.render("pages/auth/login");
};

const login = async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    req.flash("error", "Email and password are required");
    return res.redirect("/login");
  }

  if (password.length < 8) {
    req.flash("error", "Password must be at least 8 characters long");
    return res.redirect("/login");
  }

  try {
    const [userRows] = await db.query("SELECT * FROM users WHERE email = ?", [email]);

    if (userRows.length === 0) {
      const failedLoginLogger = activityLogger(`Failed login attempt for email: ${email}`, LOG_LEVELS.WARN);
      await new Promise(resolve => failedLoginLogger(req, res, resolve));
      
      req.flash("error", "Invalid credentials");
      return res.redirect("/login");
    }

    const user = userRows[0];
    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      const invalidPasswordLogger = activityLogger(`Invalid password attempt for user: ${user.username}`, LOG_LEVELS.WARN);
      await new Promise(resolve => invalidPasswordLogger(req, res, resolve));
      
      req.flash("error", "Invalid credentials");
      return res.redirect("/login");
    }

    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
    };

    const successLoginLogger = activityLogger(`User ${user.username} - ${user.role} logged IN`, LOG_LEVELS.INFO);
    await new Promise(resolve => successLoginLogger(req, res, resolve));

    req.flash("success", "Berhasil login!");
    return res.redirect("/");
  } catch (err) {
    console.error("Login error:", err);
    const errorLogger = activityLogger(`Login system error: ${err.message}`, LOG_LEVELS.ERROR);
    await new Promise(resolve => errorLogger(req, res, resolve));
    req.flash("error", "An error occurred. Please try again later.");
    return res.redirect("/login");
  }
};

const getRegisterPage = (req, res) => {
  res.render("pages/auth/register");
};

const register = async (req, res) => {
  const { username, email, password, role } = req.body;

  if (!username || !email || !password || !role) {
    req.flash("error", "All fields are required.");
    return res.redirect("/register");
  }

  if (password.length < 8) {
    req.flash("error", "Password must be at least 8 characters long.");
    return res.redirect("/register");
  }

  try {
    const [existingUsers] = await db.query("SELECT id FROM users WHERE email = ?", [email]);
    
    if (existingUsers.length > 0) {
      req.flash("error", "Email is already registered.");
      return res.redirect("/register");
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    await db.query("INSERT INTO users (username, email, password_hash, role) VALUES (?, ?, ?, ?)", 
      [username, email, hashedPassword, role]);

    const registerLogger = activityLogger(`New user registered: ${username} - ${role}`, LOG_LEVELS.INFO);
    await new Promise(resolve => registerLogger(req, res, resolve));

    req.flash("success", "Registration successful! Please login.");
    return res.redirect("/login");
  } catch (err) {
    console.error("Register error:", err);
    const errorLogger = activityLogger(`Register system error: ${err.message}`, LOG_LEVELS.ERROR);
    await new Promise(resolve => errorLogger(req, res, resolve));
    req.flash("error", "An error occurred. Please try again later.");
    return res.redirect("/register");
  }
};

const logout = async (req, res) => {
  const user = req.session.user;
  if (user) {
    const logoutLogger = activityLogger(`User ${user.username} - ${user.role} logged OUT`, LOG_LEVELS.INFO);
    await new Promise(resolve => logoutLogger(req, res, resolve));
  }
  req.session.destroy((err) => {
    if (err) {
      console.error("Error destroying session:", err);
    }
    res.redirect("/login");
  });
};

module.exports = { getLoginPage, getRegisterPage, register, logout, login };