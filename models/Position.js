const moment = require('moment');

const { Sequelize, sequelize } = require('../lib/sequelize');
const Candidate = require('./Candidate');

const Position = sequelize.define('Position', {
    name: {
        type: Sequelize.STRING,
        allowNull: false,
        defaultValue: '',
        validate: {
            notEmpty: { msg: 'Position name should be set.' },
        }
    },
    starts: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: '',
        validate: {
            notEmpty: { msg: 'Event start date should be set.' },
            isDate: { msg: 'Event start date should be valid.' }
        }
    },
    ends: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: '',
        validate: {
            notEmpty: { msg: 'Event end date should be set.' },
            isDate: { msg: 'Event end date should be valid.' },
            laterThanStart(val) {
                if (moment(val).isSameOrBefore(this.starts)) {
                    throw new Error('Event cannot start after or at the same time it ends.');
                }
            }
        }
    },
    places: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: '',
        validate: {
            notEmpty: { msg: 'Places amount should be set.' },
            isNumeric: { msg: 'Places amount should be valid.' },
            min: { args: [1], msg: 'Places amount should be at least 1' }
        }
    },
    status: {
        type: Sequelize.ENUM('open', 'closed'),
        allowNull: false,
        defaultValue: 'open',
        validate: {
            isIn: {
                args: [['open', 'closed']],
                msg: 'Position status can be one of these: "open", "closed".'
            }
        }
    },
    can_apply: {
        type: Sequelize.VIRTUAL,
        get() {
            return moment().isBetween(this.starts, this.ends, null, '[]'); // inclusive
        }
    }
}, { underscored: true, tableName: 'positions' });

Position.beforeValidate(async (position, options) => {
    if (position.starts) {
        // If it's set we set the status either to "open" or "closed"
        // based on starts and ends params.
        // Also if it should start in the future, we set the cron task for it
        // to open applications.
        // TODO: add cron task for it.
        const canApply = moment().isBetween(position.starts, position.ends, null, '[]');
        const applicationsClosed = moment().isAfter(position.ends);

        if (!position.isNewRecord) {
            const candidates = await Candidate.findAll({
                where: {
                    position_id: position.id,
                    status: { [Sequelize.Op.ne]: 'rejected' }
                }
            });
            position.setDataValue('status', (canApply || (applicationsClosed && candidates.length <= position.places)) ? 'open' : 'closed');
        } else {
            position.setDataValue('status', canApply ? 'open' : 'closed');
        }
        options.fields.push('status');
    } else {
        // Else, if it's not set, that means we want to open the application
        // period right now. So, position.starts should be the current time.

        position.setDataValue('starts', new Date());
        position.setDataValue('status', 'open');
        options.fields.push('starts');
        options.fields.push('status');
    }
});

Position.afterUpdate((position) => {
    // Yeah, nasty, but prevents us from circular dependencies issues. Been there, done that.
    // eslint-disable-next-line global-require
    const cron = require('../lib/cron');

    // Clearing the deadlines and setting them again on afterSave() (just in case).
    // Only needed on update.
    cron.clearDeadlinesForPosition(position.id);
});

Position.afterSave((position) => {
    // Yeah, nasty, but prevents us from circular dependencies issues. Been there, done that.
    // eslint-disable-next-line global-require
    const cron = require('../lib/cron');

    // Schedule 2 deadlines, one for opening and one for closing.
    // If there should be no deadline, cron will catch it.
    // Should be run on create and update.
    cron.registerOpenApplicationDeadline(position.starts, position.id);
    cron.registerCloseApplicationDeadline(position.ends, position.id);
});

module.exports = Position;