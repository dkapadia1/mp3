var mongoose = require('mongoose');

var TaskSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, default: "" },
    deadline: { type: Date, required: true },
    completed: { type: String, default: false },
    assignedUser: { type: String, default: "" },
    assignedUserName: { type: String, default: "unassigned" },
    dateCreated: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Task', TaskSchema);
