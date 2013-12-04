/**
 * @module schemas
 */

exports.message = {
  title: 'message',
  description: 'piece of information envelope into a conversation',
  type: 'object',
  properties: {
    from: {type: 'string'},
    to: {type: 'string'},
    type: {type: 'string'},
    err: {},
    content: {},
    id: {type: 'string'},
    date: {type: 'integer'},
    cb: {type: 'boolean'}
  },
  required: ['to', 'id'],
  additionalProperties: false
};
