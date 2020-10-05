"use strict";
const nodemailer = require("nodemailer");

module.exports = async function sendMail(params) {
    // create reusable transporter object using the default SMTP transport
    let transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: process.env.MAIL_PORT,
        secure: process.env.MAIL_SECURE,
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
        },
    });

    // send mail with defined transport object
    return await transporter.sendMail({
        from: process.env.MAIL_FROM,
        ...params
    });
}
