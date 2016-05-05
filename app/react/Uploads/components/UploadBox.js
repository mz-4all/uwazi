import React, {Component, PropTypes} from 'react';
import {connect} from 'react-redux';
import {bindActionCreators} from 'redux';
import Dropzone from 'react-dropzone';

import {uploadDocument, finishEdit, createDocument} from 'app/Uploads/actions/uploadsActions';
import 'app/Uploads/scss/upload_box.scss';

export class UploadBox extends Component {
  onDrop(files) {
    files.forEach((file) => {
      let doc = {title: this.extractTitle(file)};
      this.props.createDocument(doc)
      .then((newDoc) => {
        this.props.uploadDocument(newDoc._id, file);
      });
    });
    this.props.finishEdit();
  }

  extractTitle(file) {
    let title = file.name
    .replace(/\.[^/.]+$/, '')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/ {2}/g, ' ');

    return title.charAt(0).toUpperCase() + title.slice(1);
  }

  render() {
    return (
      <Dropzone style={{}} onDrop={this.onDrop.bind(this)} accept="application/pdf">
        <div className="upload-box">
          <i className="fa fa-upload"></i>
          <a>Upload your document</a>
        </div>
      </Dropzone>
    );
  }
}

UploadBox.propTypes = {
  uploadDocument: PropTypes.func,
  createDocument: PropTypes.func,
  finishEdit: PropTypes.func
};


function mapDispatchToProps(dispatch) {
  return bindActionCreators({uploadDocument, finishEdit, createDocument}, dispatch);
}

export default connect(null, mapDispatchToProps)(UploadBox);