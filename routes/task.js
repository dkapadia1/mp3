const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Task = require('../models/task');
const User = require('../models/user');

// GET /tasks - Respond with a list of tasks
router.get('/', async (req, res) => {
    try {
        // parse optional "where" query param as JSON and use as filter
        let filter = {};
        if (req.query && req.query.where) {
            try {
                filter = JSON.parse(req.query.where);
            } catch (parseErr) {
                return res.status(400).json({
                    message: 'Invalid where parameter',
                    data: { error: 'The "where" query parameter must be valid JSON' }
                });
            }
        }

        // start building query
        let query = Task.find(filter);

        // parse optional "select" parameter
        if (req.query && req.query.select) {
            try {
                const selectObj = JSON.parse(req.query.select);
                query = query.select(selectObj);
            } catch (parseErr) {
                return res.status(400).json({
                    message: 'Invalid select parameter',
                    data: { error: 'The "select" query parameter must be valid JSON' }
                });
            }
        }

        // parse optional "sort" parameter
        if (req.query && req.query.sort) {
            try {
                const sortObj = JSON.parse(req.query.sort);
                query = query.sort(sortObj);
            } catch (parseErr) {
                return res.status(400).json({
                    message: 'Invalid sort parameter',
                    data: { error: 'The "sort" query parameter must be valid JSON' }
                });
            }
        }

        // parse skip and limit
        if (req.query && req.query.skip !== undefined) {
            const skipNum = Number(req.query.skip);
            if (!Number.isInteger(skipNum) || skipNum < 0) {
                return res.status(400).json({
                    message: 'Invalid skip parameter',
                    data: { error: 'The "skip" query parameter must be a non-negative integer' }
                });
            }
            query = query.skip(skipNum);
        }

        // Default limit 100 for tasks as specified in requirements
        let limit = 100;
        if (req.query && req.query.limit !== undefined) {
            const limitNum = Number(req.query.limit);
            if (!Number.isInteger(limitNum) || limitNum < 0) {
                return res.status(400).json({
                    message: 'Invalid limit parameter',
                    data: { error: 'The "limit" query parameter must be a non-negative integer' }
                });
            }
            limit = limitNum;
        }
        query = query.limit(limit);

        // handle count=true
        if (req.query && String(req.query.count) === 'true') {
            const count = await Task.countDocuments(filter);
            return res.json({ message: 'Count fetched', data: { count } });
        }

        // execute query and return results
        const tasks = await query.lean();
        return res.json({ message: 'Tasks fetched', data: tasks });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to fetch tasks', data: { error: 'Failed to fetch tasks' } });
    }
});

// POST /tasks - Create a new task
router.post('/', async (req, res) => {
    try {
        const { name, description, deadline, completed, assignedUser, assignedUserName } = req.body;
        
        // Validate required fields
        if (!name || !deadline) {
            return res.status(400).json({
                message: 'Missing required fields',
                data: { error: 'Name and deadline are required' }
            });
        }

        const task = new Task({
            name,
            description: description || '',
            deadline,
            completed: completed || false,
            assignedUser: assignedUser || '',
            assignedUserName: assignedUserName || 'unassigned'
        });
        if (assignedUser) {
            // Verify assigned user exists
            const user = await User.findById(assignedUser);
            if (!user) {
                return res.status(400).json({message : 'Invalid assigned user', data: { error: 'Assigned user does not exist' } });
            }
            // Add task to user's pendingTasks
            await User.findByIdAndUpdate(assignedUser, {
                $addToSet: { pendingTasks: task._id }
            });
        }
        await task.save();
        return res.status(201).json({ message: 'Task created', data: task });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to create task', data: { error: 'Failed to create task' } });
    }
});

// Helper to validate ObjectId
function isValidObjectId(id) {
    return mongoose.Types.ObjectId.isValid(id);
}

// GET /tasks/:id - Respond with details of specified task
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid task id', data: { error: 'Invalid task id' } });

    try {
        // Handle select parameter for single task fetch
        let query = Task.findById(id);
        if (req.query && req.query.select) {
            try {
                const selectObj = JSON.parse(req.query.select);
                query = query.select(selectObj);
            } catch (parseErr) {
                return res.status(400).json({
                    message: 'Invalid select parameter',
                    data: { error: 'The "select" query parameter must be valid JSON' }
                });
            }
        }

        const task = await query.lean();
        if (!task) return res.status(404).json({ message: 'Task not found', data: { error: 'Task not found' } });
        return res.json({ message: 'Task fetched', data: task });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to fetch task', data: { error: 'Failed to fetch task' } });
    }
});

// PUT /tasks/:id - Replace entire task
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid task id', data: { error: 'Invalid task id' } });

    const { name, description, deadline, completed, assignedUser, assignedUserName, dateCreated } = req.body;
    
    try {
        // First get existing task to check if assignment changed
        const existingTask = await Task.findById(id);
        if (!existingTask) {
            return res.status(404).json({ message: 'Task not found', data: { error: 'Task not found' } });
        }

        // If assignedUser is changing, update user references
        if (existingTask.assignedUser !== assignedUser) {
            // Remove task from old user's pendingTasks if there was one
            if (existingTask.assignedUser) {
                await User.findByIdAndUpdate(existingTask.assignedUser, {
                    $pull: { pendingTasks: id }
                });
            }
            // Add task to new user's pendingTasks if there is one
            if (assignedUser) {
                const user = await User.findById(assignedUser);
                if (!user) {
                    return res.status(400).json({
                        message: 'Invalid assigned user',
                        data: { error: 'Assigned user does not exist' }
                    });
                }
                await User.findByIdAndUpdate(assignedUser, {
                    $addToSet: { pendingTasks: id }
                });
            }
        }

        // Update the task
        const replacement = {
            name,
            description: description || '',
            deadline,
            completed: completed || false,
            assignedUser: assignedUser || '',
            assignedUserName: assignedUserName || 'unassigned'
        };
        if (dateCreated) replacement.dateCreated = dateCreated;

        const updated = await Task.findByIdAndUpdate(id, replacement, {
            new: true,
            runValidators: true,
            overwrite: true
        }).lean();

        return res.json({ message: 'Task updated', data: updated });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ message: 'Failed to update task', data: { error: err.message } });
    }
});

// DELETE /tasks/:id - Delete specified task
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid task id', data: { error: 'Invalid task id' } });

    try {
        const deleted = await Task.findById(id);
        if (!deleted) {
            return res.status(404).json({ message: 'Task not found', data: { error: 'Task not found' } });
        }

        // Remove task from assigned user's pendingTasks if there is one
        if (deleted.assignedUser) {
            await User.findByIdAndUpdate(deleted.assignedUser, {
                $pull: { pendingTasks: id }
            });
        }

        // Delete the task
        await deleted.deleteOne();
        return res.status(200).json({ message: 'Task deleted', data: deleted });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to delete task', data: { error: 'Failed to delete task' } });
    }
});

module.exports = router;
