'use strict';
const nodemailer = require('nodemailer');

module.exports = async function sendMail(params) {
    let transporter = nodemailer.createTransport({
        host: process.env.MAIL_HOST,
        port: process.env.MAIL_PORT,
        secure: process.env.MAIL_SECURE,
        auth: {
            user: process.env.MAIL_USER,
            pass: process.env.MAIL_PASS,
        },
    });

    params = { ...params };

    if (process.env.MAIL_FORCETO) params.to = process.env.MAIL_FORCETO;

    if (!params.from) {
        if (process.env.MAIL_FROM && !process.env.MAIL_FROMNAME) params.from = process.env.MAIL_FROM;
        if (process.env.MAIL_FROM && process.env.MAIL_FROMNAME) params.from = `"${process.env.MAIL_FROMNAME}" <${process.env.MAIL_FROM}>`;
    }

    // genere le corps : text/html
    if (!params.text)
        params.text = params.html
            .replace(/(<style[^>]*>[^<]*<\/style[^>]*>)/gi, '')
            .replace(/(<script[^>]*>[^<]*<\/script[^>]*>)/gi, '')
            .replace(/(<[^>]*>)/gi, ' ');
    if (!params.html) params.html = `<p>${  params.text.replace(/\n/g, '<br />')  }</p>`;

    return await transporter.sendMail(params);
};
