const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/user');
const Task = require('../models/task');

// connect to MongoDB using env var if not already connected
const mongodbUri = process.env.mongodb_uri;
if (!mongodbUri) {
	console.warn('Warning: mongodb_uri environment variable is not set.');
} else if (mongoose.connection.readyState === 0) {
	mongoose.connect(mongodbUri, { useNewUrlParser: true, useUnifiedTopology: true })
		.catch(err => console.error('MongoDB connection error:', err));
}

// GET /users - Respond with a list of users
router.get('/', async (req, res) => {
	try {
		// parse optional "where" query param as JSON and use as filter
		let filter = {};
		if (req.query && req.query.where) {
			try {
				filter = JSON.parse(req.query.where);
			} catch (parseErr) {
				console.error('Invalid where parameter:', parseErr);
				return res.status(400).json({
					message: 'Invalid where parameter',
					data: { error: 'The "where" query parameter must be valid JSON' }
				});
			}
		}

		// start building query
		let query = User.find(filter);

		// parse optional "select" parameter
		if (req.query && req.query.select) {
			try {
				const selectObj = JSON.parse(req.query.select);
				query = query.select(selectObj);
			} catch (parseErr) {
				console.error('Invalid select parameter:', parseErr);
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
				console.error('Invalid sort parameter:', parseErr);
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

		if (req.query && req.query.limit !== undefined) {
			const limitNum = Number(req.query.limit);
			if (!Number.isInteger(limitNum) || limitNum < 0) {
				return res.status(400).json({
					message: 'Invalid limit parameter',
					data: { error: 'The "limit" query parameter must be a non-negative integer' }
				});
			}
			query = query.limit(limitNum);
		}

		// handle count=true
		if (req.query && String(req.query.count) === 'true') {
			const count = await User.countDocuments(filter).exec();
			return res.json({ message: 'Count fetched', data: { count } });
		}

		// execute query and return results
		const users = await query.lean().exec();
		return res.json({ message: 'Users fetched', data: users });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Failed to fetch users', data: { error: 'Failed to fetch users' } });
	}
});

// POST /users - Create a new user and respond with the created user
router.post('/', async (req, res) => {
	try {
		const { name, email, pendingTasks } = req.body;
		const user = new User({
			name,
			email,
			pendingTasks: Array.isArray(pendingTasks) ? pendingTasks : []
		});
		await user.save();
		return res.status(201).json({ message: 'User created', data: user });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Failed to create user', data: { error: 'Failed to create user' } });
	}
});

// Helper to validate ObjectId
function isValidObjectId(id) {
	return mongoose.Types.ObjectId.isValid(id);
}

// GET /users/:id - Respond with details of specified user or 404
router.get('/:id', async (req, res) => {
	const { id } = req.params;
	if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid user id', data: { error: 'Invalid user id' } });

	try {
		const user = await User.findById(id).lean();
		if (!user) return res.status(404).json({ message: 'User not found', data: { error: 'User not found' } });
		return res.json({ message: 'User fetched', data: user });
	} catch (err) {
		console.error(err);
		return res.status(500).json({ message: 'Failed to fetch user', data: { error: 'Failed to fetch user' } });
	}
});

// PUT /users/:id - Replace entire user with supplied user or 404
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid user id', data: { error: 'Invalid user id' } });

    const { name, email, pendingTasks, dateCreated } = req.body;
    if (typeof name !== 'string' || typeof email !== 'string') {
        return res.status(400).json({ message: 'Payload must include name and email', data: { error: 'Payload must include name and email' } });
    }

    try {
        // Get existing user to check pendingTasks changes
        const existingUser = await User.findById(id);
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found', data: { error: 'User not found' } });
        }

        // Build replacement document
        const replacement = {
            _id: id,
            name,
            email,
            pendingTasks: Array.isArray(pendingTasks) ? pendingTasks : []
        };
        if (dateCreated) replacement.dateCreated = dateCreated;

        // Update tasks' assignedUser fields
        const oldTasks = new Set(existingUser.pendingTasks);
        const newTasks = new Set(replacement.pendingTasks);

        // Remove user from tasks no longer in pendingTasks
        const tasksToUnassign = [...oldTasks].filter(taskId => !newTasks.has(taskId));
        await Task.updateMany(
            { _id: { $in: tasksToUnassign } },
            { assignedUser: '', assignedUserName: 'unassigned' }
        );

        // Add user to new tasks in pendingTasks
        const tasksToAssign = [...newTasks].filter(taskId => !oldTasks.has(taskId));
        await Task.updateMany(
            { _id: { $in: tasksToAssign } },
            { assignedUser: id, assignedUserName: name }
        );

        // Update the user
        const updated = await User.findByIdAndUpdate(id, replacement, {
            new: true,
            runValidators: true,
            overwrite: true
        }).lean();

        return res.json({ message: 'User updated', data: updated });
    } catch (err) {
        console.error(err);
        return res.status(400).json({ message: 'Failed to update user', data: { error: err.message } });
    }
});

// DELETE /users/:id - Delete specified user or 404
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    if (!isValidObjectId(id)) return res.status(400).json({ message: 'Invalid user id', data: { error: 'Invalid user id' } });

    try {
        const deleted = await User.findById(id);
        if (!deleted) {
            return res.status(404).json({ message: 'User not found', data: { error: 'User not found' } });
        }

        // Unassign user from all tasks
        await Task.updateMany(
            { assignedUser: id },
            { assignedUser: '', assignedUserName: 'unassigned' }
        );

        // Delete the user
        await deleted.deleteOne();
        return res.status(200).json({ message: 'User deleted', data: deleted });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Failed to delete user', data: { error: 'Failed to delete user' } });
    }
});

module.exports = router;