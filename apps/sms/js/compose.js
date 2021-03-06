/* -*- Mode: js; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- /
/* vim: set shiftwidth=2 tabstop=2 autoindent cindent expandtab: */

'use strict';

/**
 * Handle UI specifics of message composition. Namely,
 * resetting (auto manages placeholder text), getting
 * message content, and message size
 */
var Compose = (function() {
  var placeholderClass = 'placeholder';

  var slice = Array.prototype.slice;
  var attachments = new WeakMap();

  // will be defined in init
  var dom = {
    form: null,
    message: null,
    sendButton: null,
    attachButton: null
  };

  var handlers = {
    input: [],
    type: []
  };

  var state = {
    empty: true,
    maxLength: null,
    size: null,

    // 'sms' or 'mms'
    type: 'sms'
  };

  // handler for 'input' in contentEditable
  function composeCheck(e) {

    var textLength = dom.message.textContent.length;
    var empty = !textLength;
    var hasFrames = !!dom.message.querySelector('iframe');

    if (empty) {
      var brs = dom.message.getElementsByTagName('br');
      // firefox will keep an extra <br> in there
      if (brs.length > 1 || hasFrames) {
        empty = false;
      }
    }

    var placeholding = dom.message.classList.contains(placeholderClass);
    if (placeholding && !empty) {
      dom.message.classList.remove(placeholderClass);
      compose.disable(false);
      state.empty = false;
    }
    if (!placeholding && empty) {
      dom.message.classList.add(placeholderClass);
      compose.disable(true);
      state.empty = true;
    }

    trigger('input', e);

    if (hasFrames && state.type == 'sms') {
      compose.type = 'mms';
    }

    if (!hasFrames && state.type == 'mms') {
      // this operation is cancelable
      compose.type = 'sms';
    }

  }

  function composeKeyEvents(e) {
    // if locking and no-backspace pressed, cancel
    if (compose.lock && e.which !== 8) {
      e.preventDefault();
    } else {
      // trigger a recompute of size on the keypresses
      state.size = null;
      compose.lock = false;
    }
  }

  function trigger(type) {
    var fns = handlers[type];
    var args = slice.call(arguments, 1);

    if (fns && fns.length) {
      for (var i = 0; i < fns.length; i++) {
        fns[i].apply(this, args);
      }
    }
  }


  function insert(item) {
    var fragment = document.createDocumentFragment();

    // trigger recalc on insert
    state.size = null;

    if (item.render) { // it's an Attachment
      var node = item.render();
      attachments.set(node, item);
      fragment.appendChild(node);
    } else if (item.nodeName === 'IFRAME') {
      // this iframe is generated by us
      fragment.appendChild(item);
    } else if (typeof item === 'string') {
      var container = document.createElement('div');
      container.innerHTML = item;
      [].forEach.call(container.childNodes, function(node) {
        if (node.nodeName === 'BR') {
          fragment.appendChild(document.createElement('br'));
        }
        else if (node.nodeType === Node.TEXT_NODE) {
          fragment.appendChild(node);
        }
      });
    }

    return fragment;
  }

  var compose = {
    init: function composeInit(formId) {
      dom.form = document.getElementById(formId);
      dom.message = dom.form.querySelector('[contenteditable]');
      dom.sendButton = document.getElementById('messages-send-button');
      dom.attachButton = document.getElementById('messages-attach-button');
      dom.optionsMenu = document.getElementById('attachment-options-menu');

      // update the placeholder after input
      dom.message.addEventListener('input', composeCheck);

      // we need to bind to keydown & keypress because of #870120
      dom.message.addEventListener('keydown', composeKeyEvents);
      dom.message.addEventListener('keypress', composeKeyEvents);

      dom.message.addEventListener('click',
        this.onAttachmentClick.bind(this));

      dom.optionsMenu.addEventListener('click',
        this.onAttachmentMenuClick.bind(this));

      dom.attachButton.addEventListener('click',
        this.onAttachClick.bind(this));

      this.clear();

      return this;
    },

    on: function(type, handler) {
      if (handlers[type]) {
        handlers[type].push(handler);
      }
      return this;
    },
    off: function(type, handler) {
      if (handlers[type]) {
        var index = handlers[type].indexOf(handler);
        if (index !== -1) {
          handlers[type].splice(index, 1);
        }
      }
      return this;
    },

    getContent: function() {
      var content = [];
      var lastContent = 0;
      var node;
      var i;

      for (node = dom.message.firstChild; node; node = node.nextSibling) {
        // hunt for an attachment in the WeakMap and append it
        var attachment = attachments.get(node);
        if (attachment) {
          lastContent = content.push(attachment);
          continue;
        }

        var last = content.length - 1;
        var text = node.textContent;
        if (node.nodeName == 'BR') {
          if (node === dom.message.lastChild) {
            continue;
          }
          text = '\n';
        }

        // append (if possible) text to the last entry
        if (text.length && typeof content[last] === 'string') {
          content[last] += text;
        } else {
          // push even if text.length === 0, there could be a <br>
          content.push(text);
        }

        // keep track of the last populated line
        if (text.length > 0) {
          lastContent = content.length;
        }
      }

      return content;
    },

    getText: function() {
      var out = this.getContent().filter(function(elem) {
        return (typeof elem === 'string');
      });
      return out.join('');
    },

    isEmpty: function() {
      return state.empty;
    },

    /** Stop further input because the max size is exceded
     */
    lock: false,

    disable: function(state) {
      dom.sendButton.disabled = state;
      return this;
    },

    /** Writes node to composition element
     * @param {mixed} item Html, DOMNode, or attachment to add
     *                     to composition element.
     * @param {Boolean} position True to append, false to prepend or
     *                           undefined/null for auto (at cursor).
     */

    prepend: function(item) {
      var fragment = insert(item);

      // If the first element is a <br>, it needs to stay first
      // insert after it but before everyting else
      if (dom.message.firstChild && dom.message.firstChild.nodeName === 'BR') {
        dom.message.insertBefore(fragment, dom.message.childNodes[1]);
      } else {
        dom.message.insertBefore(fragment, dom.message.childNodes[0]);
      }

      composeCheck();
      return this;
    },

    append: function(item) {
      var fragment = insert(item);

      if (document.activeElement === dom.message) {
        var range = window.getSelection().getRangeAt(0);
        var firstNodes = fragment.firstChild;
        range.deleteContents();
        range.insertNode(fragment);
        dom.message.focus();
        range.setStartAfter(firstNodes);
      } else {
        dom.message.insertBefore(fragment, dom.message.lastChild);
      }
      composeCheck();
      return this;
    },

    clear: function() {
      dom.message.innerHTML = '<br>';
      state.full = false;
      state.size = 0;
      composeCheck();
      return this;
    },

    onAttachClick: function thui_onAttachClick(event) {
      var request = this.requestAttachment();
      request.onsuccess = this.append.bind(this);
      composeCheck(event);
    },

    onAttachmentClick: function thui_onAttachmentClick(event) {
      if (event.target.className === 'attachment') {
        this.currentAttachmentDOM = event.target;
        this.currentAttachment = attachments.get(event.target);
        AttachmentMenu.open(this.currentAttachment);
      }
    },

    onAttachmentMenuClick: function thui_onAttachmentMenuClick(event) {
      event.preventDefault();
      switch (event.target.id) {
        case 'attachment-options-view':
          this.currentAttachment.view();
          break;
        case 'attachment-options-remove':
          attachments.delete(this.currentAttachmentDOM);
          dom.message.removeChild(this.currentAttachmentDOM);
          composeCheck({type: 'input'});
          AttachmentMenu.close();
          break;
        case 'attachment-options-replace':
          var request = this.requestAttachment();
          request.onsuccess = (function replaceAttachmentWith(newAttachment) {
            var el = newAttachment.render();
            attachments.set(el, newAttachment);
            dom.message.insertBefore(el, this.currentAttachmentDOM);
            dom.message.removeChild(this.currentAttachmentDOM);
            composeCheck({type: 'input'});
            AttachmentMenu.close();
          }).bind(this);
          break;
        case 'attachment-options-cancel':
          AttachmentMenu.close();
          break;
      }
    },

    /** Initiates a 'pick' MozActivity allowing the user to create an
     * attachment
     * @return {Object} requestProxy A proxy for the underlying DOMRequest API.
     *                               An "onsuccess" and/or "onerror" callback
     *                               method may optionally be defined on this
     *                               object.
     */
    requestAttachment: function() {
      // Mimick the DOMRequest API
      var requestProxy = {};
      var activity = new MozActivity({
        name: 'pick',
        data: {
          // TODO: Extend this array with elements 'audio/*' and 'video/*'
          type: ['image/*']
        }
      });

      activity.onsuccess = function() {
        var result = activity.result;
        if (typeof requestProxy.onsuccess === 'function') {
          requestProxy.onsuccess(new Attachment(result.blob, result.name));
        }
      };

      activity.onerror = function() {
        if (typeof requestProxy.onerror === 'function') {
          requestProxy.onerror();
        }
      };

      return requestProxy;
    }

  };

  Object.defineProperty(compose, 'type', {
    get: function composeGetType() {
      return state.type;
    },
    set: function composeSetType(value) {
      // reject invalid types
      if (!(value === 'sms' || value === 'mms')) {
        return state.type;
      }
      if (value !== state.type) {
        var event = new CustomEvent('type', {
          cancelable: true
        });
        // store the old value in case of cancel
        var oldValue = state.type;
        state.type = value;
        trigger('type', event);
        if (event.defaultPrevented) {
          state.type = oldValue;
        } else {
          dom.form.dataset.messageType = state.type;
        }
      }
      return state.type;
    }
  });

  Object.defineProperty(compose, 'size', {
    get: function composeGetSize() {
      if (state.size !== null) {
        return state.size;
      }
      return state.size = this.getContent().reduce(function(sum, content) {
        if (typeof content === 'string') {
          return sum + content.length;
        } else {
          return sum + content.size;
        }
      }, 0);
    }
  });

  return compose;
}());
