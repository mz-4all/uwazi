import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import {bindActionCreators} from 'redux';

import {saveConnection, selectRangedTarget} from '../actions/actions';
import validate from 'validate.js';

export class SaveButton extends Component {

  onClick(enabled, connection) {
    if (enabled) {
      if (this.props.action === 'save') {
        this.props.saveConnection(connection, this.props.onCreate);
      }
      if (this.props.action === 'connect') {
        this.props.selectRangedTarget(connection, this.props.onRangedConnect);
      }
    }
  }

  render() {
    let connection = this.props.connection.toJS();

    const validator = {
      sourceDocument: {presence: true},
      targetDocument: {presence: true},
      relationType: {presence: true}
    };

    if (this.props.type === 'basic') {
      delete connection.sourceRange;
    }

    if (this.props.type !== 'basic') {
      validator.sourceRange = {presence: true};
    }

    const connectionReady = !validate(connection, validator);
    const disabled = !connectionReady || this.props.busy;
    const buttonClass = this.props.action === 'save' ? 'btn btn-success' : 'edit-metadata btn btn-success';
    const iClass = this.props.action === 'save' ? 'fa fa-save' : 'fa fa-arrow-right';

    return (
      <button className={buttonClass}
              disabled={disabled}
              onClick={this.onClick.bind(this, !disabled, connection)}>
        <i className={this.props.busy ? 'fa fa-spinner fa-spin' : iClass}></i>
      </button>
    );
  }
}

SaveButton.propTypes = {
  saveConnection: PropTypes.func,
  selectRangedTarget: PropTypes.func,
  onCreate: PropTypes.func,
  onRangedConnect: PropTypes.func,
  action: PropTypes.string,
  type: PropTypes.string,
  connection: PropTypes.object,
  busy: PropTypes.bool
};

function mapStateToProps({connections}) {
  return {
    type: connections.connection.get('type'),
    connection: connections.connection,
    busy: connections.uiState.get('creating') || connections.uiState.get('connecting')
  };
}

function mapDispatchToProps(dispatch) {
  return bindActionCreators({saveConnection, selectRangedTarget}, dispatch);
}

export default connect(mapStateToProps, mapDispatchToProps)(SaveButton);
