const process = require("process");
const constants = require("../utils/constants.js");
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function PaymentPlugin() {
    let self = {};
    let persistence = await $$.loadPlugin("StandardPersistence");
    let rewardPlugin = await $$.loadPlugin("RewardExchangePlugin");
    const userLogger = $$.loadPlugin("UserLoggerPlugin");
    self.persistence = persistence;

    self.createPaymentIntent = async function (paymentAmount) {
        const paymentSum = paymentAmount * 100;

        let paymentIntent = await stripe.paymentIntents.create({
            amount: paymentSum, // amount in cents
            currency: constants.APP_CURRENCY
        });
        return paymentIntent
    }

    self.finishPayment = async function (userId, paymentId) {
        try {
            const paymentIntent = await stripe.paymentIntents.retrieve(paymentId);
            let purchasedPoints = paymentIntent.amount / 100 * rewardPlugin.getPaymentRate();
            persistence.transferPoints(purchasedPoints, "system", userId, `with your ${paymentIntent.amount / 100} ${constants.APP_CURRENCY} payment.`);
            let user = await persistence.getUser(userId);
            let userStatus = await persistence.getUserLoginStatus(user.email);
            if (userStatus.role === constants.ROLES.USER) {
                userStatus.role = constants.ROLES.VALIDATED_USER;
                await persistence.updateUserLoginStatus(user.email, userStatus);
                await userLogger.userLog(userStatus.globalUserId, `Role changed from ${constants.ROLES.USER} to ${constants.ROLES.VALIDATED_USER}`);
            }

            return purchasedPoints
        } catch (e) {
            throw new Error("Payment failed: " + e.message);
        }
    }

    return self;
}

let singletonInstance = undefined;
module.exports = {
    getInstance: async function () {
        if (!singletonInstance) {
            singletonInstance = await PaymentPlugin();
        }
        return singletonInstance;
    }, getAllow: function () {
        return async function (globalUserId, email, command, ...args) {
            switch (command) {
                case "createPaymentIntent":
                    return true;
                case "finishPayment":
                    if (globalUserId === args[0]) {
                        return true;
                    }
                    return false;
                default:
                    return false;
            }
        }
    },
    getDependencies: function () {
        return ["StandardPersistence", "RewardExchangePlugin", "UserLoggerPlugin"];
    }
}
