const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { randomBytes } = require('crypto');
const { promisify } = require('util');
const { transport, makeANiceEmail } = require('../mail');

const Mutation = {
  async createItem(partent, args, ctx, info){
    if(!ctx.request.userId) {
      throw new Error('Shoot! You must be logged in to do that');
    }
    const item = await ctx.db.mutation.createItem({
      data: {
        ...args
      }
    }, info);
    
    return item;
  },
  updateItem(parent, args, ctx, info) {
    // first take a copy of the updates
    const updates = { ...args };
    // remove the ID from the updates
    delete updates.id;
    // run update method
    return ctx.db.mutation.updateItem(
      {
        data: updates,
        where: {
          id: args.id,
        },
        info
      },
    );
  }, 
  async deleteItem(parent, args, ctx, info) {
    const where = { id: args.id };
    // 1. Find the item
    const item = await ctx.db.query.item ({ where }, `{id title}`);
    // 2. Check if they oun that item, or have the permissions
    // TODO
    // 3. Delete it.
    return ctx.db.mutation.deleteItem({ where }, info);
  },
  async signup(parents, args, ctx, info) {
    // lowercase their email
    args.email = args.email.toLowerCase();
    // hash their password
    const password = await bcrypt.hash(args.password, 10);
    // create the user in the db
    const user = await ctx.db.mutation.createUser({
      data: {
        ...args,
        password: password,
        permissions: { set: ['USER'] },
      }
    }, info);
    // create the JWT token for them
    const token = jwt.sign({userId: user.id}, process.env.APP_SECRET);
    // We set jwt as a cookie on the response
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 25 * 365, // 1 year cookie
    });
    // Finally we return the user to the browser
    return user;
  },
  async signin(parent, { email, password }, ctx, info) {
    // 1. Check if there's a user with that email
    const user = await ctx.db.query.user({ where: { email }});
    if (!user) {
      throw new Error(`No such user found for email ${email}`);
    }
    // 2. Check if their password is correct
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      throw new Error('Invalid password');
    }
    // 3. Generate the JWT Token
    const token = jwt.sign({userId: user.id}, process.env.APP_SECRET);
    // 4. Set the cookie with the token
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 25 * 365, // 1 year cookie
    });
    // 5. Return the user
    return user;
  }, 
  signout(parent, args, ctx, info) {
    ctx.response.clearCookie('token');
    return { message: 'Goodbye' };
  },
  async requestReset(parent, args, ctx, info) {
    // Check if this is a real user
    const user = await ctx.db.query.user({ where: { email: args.email } });
    if(!user) {
      throw new Error(`No such user found for email ${args.email}`);
    }
    // Set reset token and expiry on that user
    const randomBytesPromisifyed = promisify(randomBytes);
    const resetToken = (await randomBytesPromisifyed(20)).toString('hex');
    const resetTokenExpiry = Date.now() + 3600000; // 1 hour from now
    const res = await ctx.db.mutation.updateUser({
      where: { email: args.email },
      data: { resetToken, resetTokenExpiry }
    });
    // Email them that reset token
    const mailRes = await transport.sendMail({
      from: 'alejandro@mintitmedia.com',
      to: user.email,
      subject: 'Your password reset token',
      html: makeANiceEmail(`Your password reset token is here \n\n <a href="${process.env.FRONTEND_URL}/reset?resetToken=${resetToken}" >Click here to reset</a>`)
    })
    // Return the message
    return { message: 'Thanks!' };
  },
  async resetPassword(parent, args, ctx, info) {
    // 1. Check if the passwords match
    if(args.password !== args.confirmPassword) {
      throw new Error('Your Passwords don\'t match');
    }
    // 2. Check if it's a legit rest token
    // 3. Check if it's expired
    const [user] = await ctx.db.query.users({
      where: {
        resetToken: args.resetToken,
        resetTokenExpiry_gte: Date.now() - 3600000,
      }
    });
    if(!user) {
      throw new Error('This token is either invalid or expired');
    }
    // 4. Hash their new password
    const password = await bcrypt.hash(args.password, 10);
    // 5. Save the new password to the user and remove old resetToken
    const updatedUser = await ctx.db.mutation.updateUser({
      where: { email: user.email},
      data: {
        password,
        resetToken: null, 
        resetTokenExpiry: null,
      }
    })
    // 6. Generate JWT
    const token = jwt.sign({ userId: updatedUser.id }, process.env.APP_SECRET);
    // 7. Set the JWT cookie
    ctx.response.cookie('token', token, {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 365,
    })
    // 8. Return the new user
    return updatedUser;
  }
};

module.exports = Mutation;
